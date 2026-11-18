import { execFileSync } from "node:child_process";
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DDB_PORT } from "../../vitest.integration.config";

const CONTAINER = "xpense-it-ddb";
const TABLE = "xpense-it";

/** Starts DynamoDB Local (unless DDB_ENDPOINT is given) and creates the table exactly like infra/stack.ts. */
export default async function setup() {
  const endpoint = process.env.DDB_ENDPOINT ?? `http://localhost:${DDB_PORT}`;
  const ownContainer = !process.env.DDB_ENDPOINT;
  if (ownContainer) {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    execFileSync("docker", ["run", "-d", "--rm", "--name", CONTAINER, "-p", `${DDB_PORT}:8000`, "amazon/dynamodb-local:2.5.4", "-jar", "DynamoDBLocal.jar", "-inMemory"], { stdio: "inherit" });
  }
  const client = new DynamoDBClient({ endpoint, region: "us-east-1", credentials: { accessKeyId: "local", secretAccessKey: "local" } });
  for (let i = 0; ; i++) {
    try {
      const { TableNames = [] } = await client.send(new ListTablesCommand({}));
      if (TableNames.includes(TABLE)) await client.send(new DeleteTableCommand({ TableName: TABLE }));
      break;
    } catch (e) {
      if (i > 60) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await client.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: "PK", AttributeType: "S" }, { AttributeName: "SK", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "PK", KeyType: "HASH" }, { AttributeName: "SK", KeyType: "RANGE" }],
      StreamSpecification: { StreamEnabled: true, StreamViewType: "NEW_AND_OLD_IMAGES" },
    }),
  );
  return () => {
    if (ownContainer) execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  };
}
