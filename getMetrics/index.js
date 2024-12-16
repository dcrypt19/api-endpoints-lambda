const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const jwt = require("jsonwebtoken");
const moment = require("moment-timezone");

const SECRET_KEY = process.env.SECRET_KEY;
const REGION = "eu-north-1";

const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

async function getMetrics(event) {
  console.log("Received event:", JSON.stringify(event)); // Log para depurar el evento recibido

  // Obtener el token desde el encabezado de autorización
  const authHeader = event.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7); // Eliminar el prefijo 'Bearer '
  }

  // Continuar con el manejo del evento usando el token
  console.log("Extracted token:", token);

  if (!token) {
    console.log("No token found in query parameters");
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
    console.log("Decoded token:", decoded);
  } catch (err) {
    console.log("Invalid token:", err);
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Invalid token" }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  }

  try {
    // Obtener el primer y último día del mes actual
    const startOfMonth = moment().startOf("month").format("YYYY-MM-DD");
    const endOfMonth = moment().endOf("month").format("YYYY-MM-DD");

    console.log(`Querying for metrics from ${startOfMonth} to ${endOfMonth}`);

    // Query para obtener las estadísticas del mes actual
    const metricsResult = await ddbDocClient.send(
      new QueryCommand({
        TableName: "EstadisticasDiarias",
        KeyConditionExpression:
          "userPhoneID = :userPhoneID AND #fecha BETWEEN :startOfMonth AND :endOfMonth",
        ExpressionAttributeNames: {
          "#fecha": "fecha",
        },
        ExpressionAttributeValues: {
          ":userPhoneID": userPhoneID,
          ":startOfMonth": startOfMonth,
          ":endOfMonth": endOfMonth,
        },
      })
    );

    const stats = metricsResult.Items;
    console.log("Metrics result:", JSON.stringify(stats));

    // Inicializar variables para las métricas mensuales
    let chatsIniciados = 0;
    let totalReservas = 0;
    let reservationCancellations = 0;

    // Inicializar un objeto para almacenar métricas semanales
    const weeklyMetrics = {};

    stats.forEach((stat) => {
      chatsIniciados += stat.chatsCreados || 0;
      totalReservas += stat.reservasConfirmadas || 0;
      reservationCancellations += stat.reservasCanceladas || 0;

      // Calcular la semana del año
      const weekOfYear = moment(stat.fecha).week();
      if (!weeklyMetrics[weekOfYear]) {
        weeklyMetrics[weekOfYear] = {
          week: `Semana ${weekOfYear}`,
          chatsIniciados: 0,
          totalReservas: 0,
          reservationCancellations: 0,
        };
      }

      // Acumular las métricas en el objeto semanal
      weeklyMetrics[weekOfYear].chatsIniciados += stat.chatsCreados || 0;
      weeklyMetrics[weekOfYear].totalReservas += stat.reservasConfirmadas || 0;
      weeklyMetrics[weekOfYear].reservationCancellations +=
        stat.reservasCanceladas || 0;
    });

    // Convertir el objeto de métricas semanales en un array
    const weeklyData = Object.values(weeklyMetrics);

    const metrics = {
      chatsIniciados,
      totalReservas,
      reservationCancellations,
      weeklyData, // Incluir las métricas semanales en la respuesta
    };

    console.log("Calculated metrics:", JSON.stringify(metrics));

    // Devuelve una respuesta exitosa con las métricas
    return {
      statusCode: 200,
      body: JSON.stringify(metrics),
      headers: {
        "Content-Type": "application/json",
      },
    };
  } catch (error) {
    console.error("Error al recuperar las métricas:", error);
    // Devuelve una respuesta de error
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Error interno del servidor" }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  }
}

exports.handler = getMetrics;
