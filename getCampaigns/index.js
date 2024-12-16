// index.js

const {
  DynamoDBClient,
  QueryCommand,
  GetItemCommand,
} = require("@aws-sdk/client-dynamodb");

// Configuración del cliente de DynamoDB
const dynamoDbClient = new DynamoDBClient({ region: "eu-north-1" });

/**
 * Función Lambda para obtener las campañas de marketing asociadas a un userPhoneID.
 *
 * @param {Object} event - Evento que contiene los parámetros de la solicitud.
 * @param {Object} context - Contexto de la ejecución de Lambda.
 * @returns {Object} - Respuesta con la lista de campañas y la cuota restante, o un error.
 */
exports.handler = async (event, context) => {
  try {
    // Obtener parámetros de la solicitud
    const { userPhoneID } = event.queryStringParameters;

    if (!userPhoneID) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Bad Request: Missing userPhoneID parameter.",
        }),
      };
    }

    // Configurar los parámetros de la consulta para Campaigns
    const params = {
      TableName: "Campaigns",
      KeyConditionExpression: "userPhoneID = :uid",
      ExpressionAttributeValues: {
        ":uid": { S: userPhoneID },
      },
      ScanIndexForward: false, // Orden descendente por timestamp
    };

    // Ejecutar la consulta para obtener las campañas
    const command = new QueryCommand(params);
    const response = await dynamoDbClient.send(command);

    // Formatear las campañas
    const campaigns = response.Items.map((item) => ({
      campaignId: item.campaignId.S,
      campaignName: item.campaignName.S,
      templateUsed: item.templateUsed.S,
      numbersSent: item.numbersSent.SS,
      timestamp: parseInt(item.timestamp.N, 10),
    }));

    // Obtener la fecha actual en formato YYYY-MM-DD
    const today = new Date().toISOString().split("T")[0];

    // Obtener el recuento de mensajes enviados hoy para este userPhoneID
    const getParams = {
      TableName: "DailyMessageCount",
      Key: {
        userPhoneID: { S: userPhoneID },
        date: { S: today },
      },
    };

    const getCommand = new GetItemCommand(getParams);
    const getResponse = await dynamoDbClient.send(getCommand);

    const currentCount = getResponse.Item
      ? parseInt(getResponse.Item.messageCount.N, 10)
      : 0;
    const remainingQuota = 100 - currentCount;

    return {
      statusCode: 200,
      body: JSON.stringify({
        campaigns,
        remainingQuota,
      }),
    };
  } catch (error) {
    console.error("Error en getCampaigns handler:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error Interno del Servidor" }),
    };
  }
};

