import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sources from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Stable secret across deploys without a paid secrets store: context, else generated once into a gitignored file. */
function originSecret(scope: Construct): string {
  const fromContext = scope.node.tryGetContext("originSecret");
  if (fromContext) return fromContext;
  const file = join(ROOT, ".origin-secret");
  if (!existsSync(file)) writeFileSync(file, randomUUID(), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

export class FinanceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const alertEmail: string | undefined = this.node.tryGetContext("alertEmail");
    if (!alertEmail) throw new Error("Missing context: -c alertEmail=<operator email> (alarms and budget need a real address)");
    const smoke = this.node.tryGetContext("smoke") === "true";
    const allowPoison = this.node.tryGetContext("allowPoison") === "true";

    // ---------- storage ----------
    // Provisioned 25/25 = DynamoDB Always Free; on-demand and auto scaling are not free (research R6).
    const table = new dynamodb.Table(this, "FinanceTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 25,
      writeCapacity: 25,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ---------- auth ----------
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      passwordPolicy: { minLength: 8, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // given_name/family_name are standard attributes (no schema entry needed). Custom attributes can be
      // added to a live pool but never changed or removed, so keep this one generic.
      customAttributes: { institution: new cognito.StringAttribute({ minLen: 1, maxLen: 100, mutable: true }) },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const userPoolClient = userPool.addClient("WebClient", {
      generateSecret: false,
      authFlows: { userSrp: true, adminUserPassword: smoke },
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });
    // Expo app: SRP via amazon-cognito-identity-js, so the password never leaves the device.
    const mobileClient = userPool.addClient("MobileClient", {
      generateSecret: false,
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });

    const alerts = new sns.Topic(this, "Alerts");
    alerts.addSubscription(new subs.EmailSubscription(alertEmail));

    // ---------- queues ----------
    const dlq = (name: string) => new sqs.Queue(this, name, { retentionPeriod: Duration.days(14), enforceSSL: true });
    const ingestDlq = dlq("IngestDlq");
    const forecastDlq = dlq("ForecastDlq");
    const streamDlq = dlq("StreamDlq");
    const ingestQueue = new sqs.Queue(this, "IngestQueue", {
      visibilityTimeout: Duration.minutes(30),
      enforceSSL: true,
      deadLetterQueue: { queue: ingestDlq, maxReceiveCount: 3 },
    });
    const forecastQueue = new sqs.Queue(this, "ForecastQueue", {
      visibilityTimeout: Duration.minutes(12),
      enforceSSL: true,
      deadLetterQueue: { queue: forecastDlq, maxReceiveCount: 3 },
    });

    const uploadBucket = new s3.Bucket(this, "UploadBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(1) }],
      // Origin "*" avoids a CloudFront↔bucket dependency cycle; the presigned POST policy is the authorization.
      cors: [{ allowedMethods: [s3.HttpMethods.POST], allowedOrigins: ["*"], allowedHeaders: ["*"] }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ---------- functions ----------
    const fn = (name: string, entry: string, timeout: Duration, environment: Record<string, string>) =>
      new NodejsFunction(this, name, {
        entry: join(ROOT, "backend/src", entry),
        projectRoot: ROOT,
        depsLockFilePath: join(ROOT, "package-lock.json"),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout,
        loggingFormat: lambda.LoggingFormat.JSON,
        logGroup: new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
        environment: { TABLE_NAME: table.tableName, COMPONENT: name, ...environment },
        bundling: { minify: true, sourceMap: false, target: "node22" },
      });

    const secret = originSecret(this);
    const api = fn("Api", "api.ts", Duration.seconds(10), {
      USER_POOL_ID: userPool.userPoolId,
      CLIENT_ID: `${userPoolClient.userPoolClientId},${mobileClient.userPoolClientId}`,
      ORIGIN_SECRET: secret,
      INGEST_QUEUE_URL: ingestQueue.queueUrl,
      UPLOAD_BUCKET: uploadBucket.bucketName,
    });
    table.grantReadWriteData(api);
    ingestQueue.grantSendMessages(api); // deleteUser / deleteAccountData only
    uploadBucket.grantPut(api, "uploads/*"); // presigned POST is signed with the API role
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ["cognito-idp:AdminDeleteUser"], resources: [userPool.userPoolArn] }));
    const apiUrl = api.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    const streamRouter = fn("StreamRouter", "stream-router.ts", Duration.seconds(30), {
      INGEST_QUEUE_URL: ingestQueue.queueUrl,
      FORECAST_QUEUE_URL: forecastQueue.queueUrl,
    });
    ingestQueue.grantSendMessages(streamRouter);
    forecastQueue.grantSendMessages(streamRouter);
    streamRouter.addEventSource(
      new sources.DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 100,
        maxBatchingWindow: Duration.seconds(60),
        retryAttempts: 3,
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
        onFailure: new sources.SqsDlq(streamDlq),
      }),
    );

    const ingestWorker = fn("IngestWorker", "ingest-worker.ts", Duration.minutes(5), {
      UPLOAD_BUCKET: uploadBucket.bucketName,
      DDB_MAX_ATTEMPTS: "10",
      ...(allowPoison ? { ALLOW_POISON: "true" } : {}),
    });
    table.grantReadWriteData(ingestWorker);
    uploadBucket.grantRead(ingestWorker);
    ingestWorker.addEventSource(new sources.SqsEventSource(ingestQueue, { batchSize: 1, maxConcurrency: 2, reportBatchItemFailures: true }));

    const forecastWorker = fn("ForecastWorker", "forecast-worker.ts", Duration.minutes(2), {
      FORECAST_QUEUE_URL: forecastQueue.queueUrl,
      DDB_MAX_ATTEMPTS: "10",
    });
    table.grantReadWriteData(forecastWorker);
    forecastQueue.grantSendMessages(forecastWorker);
    forecastWorker.addEventSource(
      new sources.SqsEventSource(forecastQueue, { batchSize: 100, maxBatchingWindow: Duration.seconds(60), maxConcurrency: 2, reportBatchItemFailures: true }),
    );

    // Daily refresh: EventBridge Scheduler (free allowance) invokes the worker directly — no custom events (R2).
    const schedulerRole = new iam.Role(this, "SchedulerRole", { assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com") });
    forecastWorker.grantInvoke(schedulerRole);
    new scheduler.CfnSchedule(this, "DailyForecast", {
      scheduleExpression: "cron(0 2 * * ? *)",
      scheduleExpressionTimezone: "UTC",
      flexibleTimeWindow: { mode: "OFF" },
      target: { arn: forecastWorker.functionArn, roleArn: schedulerRole.roleArn, input: JSON.stringify({ mode: "daily" }) },
    });

    // ---------- CDN ----------
    // SPA routing via a CloudFront Function (free tier) — distribution-wide error responses would also rewrite API 404s.
    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event){var r=event.request;if(r.uri.indexOf('.')===-1){r.uri='/index.html';}return r;}",
      ),
    });
    const distribution = new cloudfront.Distribution(this, "Site", {
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.FunctionUrlOrigin(apiUrl, { customHeaders: { "x-origin-secret": secret } }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });


    // ---------- alarms (9 alarm metrics of the 10 free, research R13) ----------
    const action = new cwActions.SnsAction(alerts);
    const fns = { api, streamRouter, ingestWorker, forecastWorker };
    new cw.Alarm(this, "ErrorsAlarm", {
      alarmDescription: "Lambda errors across all functions",
      metric: new cw.MathExpression({
        expression: Object.keys(fns).join(" + "),
        usingMetrics: Object.fromEntries(Object.entries(fns).map(([k, f]) => [k, f.metricErrors({ period: Duration.minutes(5), statistic: "Sum" })])),
        period: Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);

    const dlqs = { ingestDlq, forecastDlq, streamDlq };
    new cw.Alarm(this, "DlqAlarm", {
      alarmDescription: "Failed jobs waiting in a dead-letter queue",
      metric: new cw.MathExpression({
        expression: Object.keys(dlqs).join(" + "),
        usingMetrics: Object.fromEntries(Object.entries(dlqs).map(([k, q]) => [k, q.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: "Maximum" })])),
        period: Duration.minutes(5),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);

    new cw.Alarm(this, "ThrottleAlarm", {
      alarmDescription: "DynamoDB throttling (25 RCU/WCU free capacity exceeded)",
      metric: new cw.MathExpression({
        expression: "r + w",
        usingMetrics: {
          r: table.metric("ReadThrottleEvents", { period: Duration.minutes(5), statistic: "Sum" }),
          w: table.metric("WriteThrottleEvents", { period: Duration.minutes(5), statistic: "Sum" }),
        },
        period: Duration.minutes(5),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);

    // ---------- cost ----------
    {
      const subscribers = [{ subscriptionType: "EMAIL", address: alertEmail }];
      new budgets.CfnBudget(this, "CostBudget", {
        budget: { budgetType: "COST", timeUnit: "MONTHLY", budgetLimit: { amount: 0.1, unit: "USD" } },
        notificationsWithSubscribers: [
          { notification: { notificationType: "ACTUAL", comparisonOperator: "GREATER_THAN", threshold: 50, thresholdType: "PERCENTAGE" }, subscribers },
          { notification: { notificationType: "FORECASTED", comparisonOperator: "GREATER_THAN", threshold: 100, thresholdType: "PERCENTAGE" }, subscribers },
        ],
      });
    }

    new CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "MobileClientId", { value: mobileClient.userPoolClientId });
    new CfnOutput(this, "IngestDlqArn", { value: ingestDlq.queueArn });
    new CfnOutput(this, "FunctionUrl", { value: apiUrl.url, description: "Direct calls are rejected (403); use SiteUrl/api" });
  }
}
