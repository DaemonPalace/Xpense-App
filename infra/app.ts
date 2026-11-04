import { App } from "aws-cdk-lib";
import { FinanceStack } from "./stack";

const app = new App();
new FinanceStack(app, "FinanceStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" },
});
