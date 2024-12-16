const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.SECRET_KEY;
const REGION = "eu-north-1";

const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

async function handler(event) {
  console.log("Received event:", JSON.stringify(event)); // Log para depurar el evento recibido

  // Obtener el token desde el encabezado de autorización
  const authHeader = event.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7); // Eliminar el prefijo 'Bearer '
  }

  if (!token) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized" }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  }

  let userPhoneID;
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    userPhoneID = decoded.userPhoneID;
    console.log("Decoded token:", decoded); // Log para depurar el token decodificado
  } catch (err) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Invalid token" }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  }

  const queryParams = event.queryStringParameters || {};
  const { thread_id } = queryParams;

  if (thread_id) {
    // Caso específico para obtener todos los mensajes de un chat
    try {
      const mensajesResult = await ddbDocClient.send(
        new QueryCommand({
          TableName: "Messages",
          KeyConditionExpression: "chat_id = :chat_id",
          ExpressionAttributeValues: {
            ":chat_id": thread_id,
          },
        })
      );
      const mensajes = mensajesResult.Items;

      // Ordenar los mensajes por timestamp
      mensajes.sort((a, b) => a.timestamp - b.timestamp);

      return {
        statusCode: 200,
        body: JSON.stringify(mensajes),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      console.error("Error al recuperar los mensajes:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Error interno del servidor" }),
        headers: {
          "Content-Type": "application/json",
        },
      };
    }
  } else {
    // Caso para obtener todos los chats y mensajes como en la implementación original
    try {
      const chatsResult = await ddbDocClient.send(
        new QueryCommand({
          TableName: "Chats",
          KeyConditionExpression: "userPhoneID = :userPhoneID",
          ExpressionAttributeValues: {
            ":userPhoneID": userPhoneID,
          },
        })
      );
      const chats = chatsResult.Items;

      const chatsWithDetails = await Promise.all(
        chats.map(async (chat) => {
          const numeroSinPrefijo = chat.cliente_tfn.slice(2);

          const mensajesResult = await ddbDocClient.send(
            new QueryCommand({
              TableName: "Messages",
              KeyConditionExpression: "chat_id = :chat_id",
              ExpressionAttributeValues: {
                ":chat_id": chat.thread_id,
              },
            })
          );
          const mensajes = mensajesResult.Items;
          mensajes.sort((a, b) => a.timestamp - b.timestamp);

          return {
            ...chat,
            cliente_tfn_sin_prefijo: numeroSinPrefijo,
            messages: mensajes,
          };
        })
      );

      return {
        statusCode: 200,
        body: JSON.stringify(chatsWithDetails),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (error) {
      console.error("Error al recuperar los chats y mensajes:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Error interno del servidor" }),
        headers: {
          "Content-Type": "application/json",
        },
      };
    }
  }
}

exports.handler = handler;
