const {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} = require("@aws-sdk/client-apigatewaymanagementapi");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const REGION = "eu-north-1";

const apiGwManagementApi = new ApiGatewayManagementApiClient({
  region: REGION,
  endpoint,
});
const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * Envía un mensaje a un cliente conectado a través de su ID de conexión.
 * @param {string} connectionId - ID de conexión del cliente
 * @param {object} data - Datos a enviar al cliente
 * @param {string} userPhoneID - ID del teléfono del usuario
 * @returns {Promise<void>}
 * @throws {Error} - Si hay un error al enviar el mensaje
 */
async function sendToConnection(connectionId, data, userPhoneID) {
  try {
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data),
    });
    await apiGwManagementApi.send(command);
    console.log(`Message sent to connection ${connectionId}`);
  } catch (error) {
    if (error.name === "GoneException") {
      console.error(`Removing stale connection ID: ${connectionId}`);
      await removeConnectionId(connectionId, userPhoneID);
    } else {
      console.error(
        `Error sending message to connection ${connectionId}:`,
        error
      );
      throw error;
    }
  }
}

/**
 * Elimina una conexión de la base de datos DynamoDB.
 * @param {string} connectionId - ID de conexión del cliente
 * @param {string} userPhoneID - ID del teléfono del usuario
 * @returns {Promise<void>}
 */
async function removeConnectionId(connectionId, userPhoneID) {
  const params = {
    TableName: "Connections",
    Key: {
      id: connectionId,
      userPhoneID: userPhoneID,
    },
  };

  try {
    const command = new DeleteCommand(params);
    await ddbDocClient.send(command);
    console.log(`Connection ID ${connectionId} removed from database.`);
  } catch (error) {
    console.error(
      `Error removing connection ID ${connectionId} from database:`,
      error
    );
    throw error;
  }
}

module.exports = {
  sendToConnection,
};
