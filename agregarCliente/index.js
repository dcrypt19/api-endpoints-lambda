const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const REGION = "eu-north-1";
const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const { sendToConnection } = require("./awsGateway");

async function handler(event) {
  const { userPhoneID, cliente_tfn, nombre } = JSON.parse(event.body);

  try {
    // Consultar el thread_id usando userPhoneID y cliente_tfn
    const queryResponse = await ddbDocClient.send(
      new QueryCommand({
        TableName: "Chats",
        IndexName: "ClientPhoneIndex",
        KeyConditionExpression: "cliente_tfn = :cliente_tfn",
        FilterExpression: "userPhoneID = :userPhoneID",
        ExpressionAttributeValues: {
          ":cliente_tfn": cliente_tfn,
          ":userPhoneID": userPhoneID,
        },
      })
    );

    const chats = queryResponse.Items;
    if (chats.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Chat not found" }),
      };
    }

    const chat = chats[0]; // Dado que solo puede haber una entrada para userPhoneID y cliente_tfn
    const thread_id = chat.thread_id;

    // Actualizar el nombre en la tabla Chats
    const updateCommand = new UpdateCommand({
      TableName: "Chats",
      Key: {
        userPhoneID: userPhoneID,
        thread_id: thread_id,
      },
      UpdateExpression: "SET nombre = :nombre",
      ExpressionAttributeValues: {
        ":nombre": nombre,
      },
    });

    await ddbDocClient.send(updateCommand);
    console.log(`Nombre actualizado para el cliente ${cliente_tfn}.`);

    // Obtener todas las conexiones de la tabla Connections
    const connectionsData = await ddbDocClient.send(
      new ScanCommand({
        TableName: "Connections",
        FilterExpression: "userPhoneID = :userPhoneID",
        ExpressionAttributeValues: {
          ":userPhoneID": { S: userPhoneID },
        },
      })
    );
    const connections = connectionsData.Items;

    // Enviar notificación a todos los clientes conectados
    for (let connection of connections) {
      const connectionId = connection.id.S;
      const userPhoneIDConnected = connection.userPhoneID.S; // Para usar en caso de eliminación de la conexión

      const postData = {
        type: "newCliente",
        message,
        sender,
        timestamp,
      };

      try {
        await sendToConnection(connectionId, postData, userPhoneIDConnected);
        console.log("Notificación websocket enviada a", connectionId);
      } catch (sendError) {
        console.error(
          "Error al enviar notificación a",
          connectionId,
          sendError
        );
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Nombre actualizado" }),
    };
  } catch (error) {
    console.error("Error al actualizar el nombre del cliente:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error al actualizar el nombre" }),
    };
  }
}


module.exports = { handler };
