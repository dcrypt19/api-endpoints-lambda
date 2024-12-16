// index.js (Lambda para enviar campañas de marketing)

const axios = require("axios");
const FormData = require("form-data");
const {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
require("dotenv").config();

// Configuración del cliente de DynamoDB
const dynamoDbClient = new DynamoDBClient({ region: "eu-north-1" });

// Variables de entorno
const token = process.env.WHATSAPP_TOKEN;

// Constante para el límite diario
const DAILY_LIMIT = 100;

// Prefijo predeterminado para números sin prefijo
const DEFAULT_PREFIX = "+34"; // Cambia esto según el prefijo que necesites

/**
 * Genera un ID único combinando la marca de tiempo con caracteres aleatorios.
 *
 * @returns {string} - ID único generado.
 */
function generateUniqueId() {
  const timestamp = Date.now().toString(36); // Convierte el timestamp a base 36
  const randomChars = Math.random().toString(36).substring(2, 8); // Genera 6 caracteres aleatorios
  return `${timestamp}-${randomChars}`;
}

/**
 * Mapea códigos de idioma abreviados a códigos BCP 47 completos.
 *
 * @param {string} code - Código de idioma abreviado (ej. 'es').
 * @returns {string} - Código de idioma completo (ej. 'es_ES').
 */
function mapLanguageCode(code) {
  const languageMap = {
     es: "es_ES",
     en: "en_US",
     fr: "fr_FR",
  };

  return languageMap[code] || code; // Retorna el mapeo o el código original si no existe
}

/**
 * Función Lambda para enviar campañas de marketing masivas a través de la API de WhatsApp.
 *
 * @param {Object} event - Evento que contiene los datos necesarios para enviar la campaña.
 * @param {Object} context - Contexto de la ejecución de Lambda.
 * @returns {Object} - Respuesta indicando el éxito o fallo de la operación.
 */
exports.handler = async (event, context) => {
  console.log("Evento recibido:", event);
  try {
    // Obtener datos del evento
    const {
      userPhoneID,
      templateId,
      templateName, // Nuevo parámetro
      campaignName,
      numbers,
      variables,
      image,
      languageCode, // Agregar languageCode desde el payload
    } = JSON.parse(event.body);

    console.log("Datos recibidos:", {
      userPhoneID,
      templateId,
      templateName,
      campaignName,
      numbers,
      variables,
      image,
      languageCode,
    });

    // Validación de parámetros
    if (
      !userPhoneID ||
      !templateId ||
      !templateName || // Validar templateName
      !campaignName ||
      !numbers ||
      !Array.isArray(numbers) ||
      !languageCode // Validar que languageCode esté presente
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Bad Request: Missing or invalid parameters.",
        }),
      };
    }

    // Mapear el código de idioma al formato BCP 47
    const mappedLanguageCode = mapLanguageCode(languageCode);
    console.log("Código de idioma mapeado:", mappedLanguageCode);

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

    console.log(`Mensajes enviados hoy: ${currentCount}`);

    // Verificar si el envío actual excede el límite diario
    if (currentCount + numbers.length > DAILY_LIMIT) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: `Límite diario de mensajes alcanzado. Puedes enviar hasta ${DAILY_LIMIT} mensajes por día.`,
          remaining: DAILY_LIMIT - currentCount,
        }),
      };
    }

    // Validar y formatear los números de teléfono
    const formattedNumberList = validateAndFormatNumbers(numbers);

    console.log("Números formateados válidos:", formattedNumberList);

    if (formattedNumberList.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "No hay números válidos para enviar la campaña.",
        }),
      };
    }

    // Verificar nuevamente el límite después del formateo (si se eliminan números inválidos)
    if (currentCount + formattedNumberList.length > DAILY_LIMIT) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: `Límite diario de mensajes alcanzado tras la validación. Puedes enviar hasta ${DAILY_LIMIT} mensajes por día.`,
          remaining: DAILY_LIMIT - currentCount,
        }),
      };
    }

    // Generar un campaignId único
    const campaignId = generateUniqueId();

    // Si hay una imagen, subirla a WhatsApp para obtener un media_id
    let mediaId = null;
    if (image) {
      mediaId = await uploadImageToWhatsApp(image, userPhoneID);
      if (!mediaId) {
        throw new Error("Error al subir la imagen a WhatsApp");
      }
    }

    // Enviar mensajes a todos los números en lotes para optimizar el rendimiento
    const batchSize = 10; // Tamaño del lote
    const batches = [];

    for (let i = 0; i < formattedNumberList.length; i += batchSize) {
      batches.push(formattedNumberList.slice(i, i + batchSize));
    }

    const results = [];
    const successfulNumbers = [];

    for (const batch of batches) {
      const sendPromises = batch.map((number) =>
        sendTemplateMessage(
          number,
          templateName, // Pasar el nombre del template
          userPhoneID,
          variables,
          mediaId,
          mappedLanguageCode // Pasar el código de idioma mapeado
        )
      );
      const batchResults = await Promise.allSettled(sendPromises);
      batchResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          successfulNumbers.push(batch[index]);
        }
        results.push(result);
      });
    }

    // Procesar resultados
    const failed = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failed.push({
          number: formattedNumberList[index],
          error: result.reason.message,
        });
      }
    });

    console.log(`Mensajes exitosos: ${successfulNumbers.length}`);
    console.log(`Mensajes fallidos: ${failed.length}`);

    // Guardar campaña en la tabla Campaigns
    await saveCampaign(
      userPhoneID,
      campaignId,
      campaignName,
      templateName, // Usar el nombre del template
      successfulNumbers
    );

    // Actualizar el recuento diario en la tabla DailyMessageCount
    const updateParams = {
      TableName: "DailyMessageCount",
      Key: {
        userPhoneID: { S: userPhoneID },
        date: { S: today },
      },
      UpdateExpression: "ADD messageCount :count",
      ExpressionAttributeValues: {
        ":count": { N: successfulNumbers.length.toString() },
      },
      ReturnValues: "UPDATED_NEW",
    };

    const updateCommand = new UpdateItemCommand(updateParams);
    await dynamoDbClient.send(updateCommand);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Campaña enviada",
        campaignId,
        successful: successfulNumbers,
        failed,
      }),
    };
  } catch (error) {
    console.error("Error en sendMarketingCampaign handler:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error Interno del Servidor" }),
    };
  }
};

/**
 * Función para validar y formatear números de teléfono.
 */
function validateAndFormatNumbers(numberList) {
  const regex = /^\+\d{10,15}$/; // Define el formato esperado
  const formattedNumbers = [];
  const invalidNumbers = [];

  numberList.forEach((num) => {
    // Eliminar espacios y caracteres no deseados
    let cleanedNumber = num.replace(/\s+/g, "");

    // Verificar si el número ya tiene un prefijo '+34'
    if (cleanedNumber.startsWith("+34")) {
      if (cleanedNumber.startsWith("+3434")) {
        // Duplicación del prefijo '34', eliminar el segundo '34'
        cleanedNumber = "+34" + cleanedNumber.slice(4);
        console.warn(
          `Prefijo duplicado encontrado y corregido: ${cleanedNumber}`
        );
      }

      if (cleanedNumber.length !== 12) {
        // '+34' + 9 dígitos = 12 caracteres
        console.warn(
          `Número inválido omitido (longitud incorrecta): ${cleanedNumber}`
        );
        invalidNumbers.push(cleanedNumber);
        return;
      }
      // Número correctamente formateado, no hacer nada
    } else if (cleanedNumber.startsWith("34") && cleanedNumber.length === 11) {
      // Número con código de país pero sin '+', añadir '+'
      cleanedNumber = `+${cleanedNumber}`;
    } else if (!cleanedNumber.startsWith("+")) {
      // Número sin código de país, añadir prefijo predeterminado
      cleanedNumber = `${DEFAULT_PREFIX}${cleanedNumber}`;
    } else {
      // Si empieza con '+' pero no con '+34', marcar como inválido
      console.warn(
        `Número inválido omitido (prefijo no permitido): ${cleanedNumber}`
      );
      invalidNumbers.push(cleanedNumber);
      return;
    }

    // Validar el formato usando una expresión regular
    if (regex.test(cleanedNumber)) {
      formattedNumbers.push(cleanedNumber);
    } else {
      console.warn(`Número inválido omitido: ${cleanedNumber}`);
      invalidNumbers.push(cleanedNumber);
    }
  });

  if (invalidNumbers.length > 0) {
    console.warn(`Se omitieron ${invalidNumbers.length} números inválidos.`);
  }

  return formattedNumbers;
}

/**
 * Envía un mensaje de plantilla a través de la API de WhatsApp.
 *
 * @param {string} to - Número de teléfono del destinatario.
 * @param {string} templateName - Nombre de la plantilla a utilizar.
 * @param {string} userPhoneID - ID del teléfono de usuario de WhatsApp.
 * @param {Object} variables - Variables para reemplazar en el template.
 * @param {string|null} mediaId - ID de media para adjuntar al mensaje.
 * @param {string} languageCode - Código de idioma para el template.
 * @returns {Promise<Object>} - Respuesta de la API de WhatsApp.
 */
async function sendTemplateMessage(
  to,
  templateName,
  userPhoneID,
  variables,
  mediaId,
  languageCode
) {
  const apiUrl = `https://graph.facebook.com/v21.0/${userPhoneID}/messages`;

  const template = {
    name: templateName, // Usar el nombre del template
    language: {
      code: languageCode,
    },
  };

  // Agregar componentes dinámicos
  const components = [];

  if (variables && Object.keys(variables).length > 0) {
    const bodyParameters = Object.keys(variables)
      .sort(
        (a, b) =>
          parseInt(a.replace("var", "")) - parseInt(b.replace("var", ""))
      )
      .map((key) => ({
        type: "text",
        text: variables[key],
      }));

    components.push({
      type: "body",
      parameters: bodyParameters,
    });
  }

  // Si hay una imagen, agregarla al header
  if (mediaId) {
    components.push({
      type: "header",
      parameters: [
        {
          type: "image",
          image: {
            id: mediaId, // Usar 'id' en lugar de 'link'
          },
        },
      ],
    });
  }

  if (components.length > 0) {
    template.components = components;
  }

  const messageData = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template,
  };

  try {
    const response = await axios.post(apiUrl, messageData, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    console.log(`Mensaje enviado a ${to}:`, response.data);
    return response.data;
  } catch (error) {
    console.error(
      `Error al enviar mensaje a ${to}:`,
      error.response?.data || error
    );
    throw new Error(
      error.response?.data?.error?.message || "Error al enviar el mensaje"
    );
  }
}

/**
 * Sube una imagen a WhatsApp y devuelve el ID de media.
 */
async function uploadImageToWhatsApp(image, userPhoneID) {
  const apiUrl = `https://graph.facebook.com/v21.0/${userPhoneID}/media`;

  const formData = new FormData();
  const buffer = Buffer.from(image.data, "base64");
  formData.append("file", buffer, {
    filename: image.filename,
    contentType: image.mimeType,
  });
  formData.append("messaging_product", "whatsapp");
  formData.append("type", "image");

  try {
    const response = await axios.post(apiUrl, formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${token}`,
      },
    });

    console.log("Imagen subida a WhatsApp:", response.data);
    return response.data.id; // ID de media para usar en el template
  } catch (error) {
    console.error(
      "Error al subir la imagen a WhatsApp:",
      error.response?.data || error
    );
    return null;
  }
}

/**
 * Guarda los detalles de la campaña en la tabla DynamoDB Campaigns.
 */
async function saveCampaign(
  userPhoneID,
  campaignId,
  campaignName,
  templateUsed,
  successfulNumbers
) {
  const timestamp = Date.now().toString();

  const params = {
    TableName: "Campaigns",
    Item: {
      userPhoneID: { S: userPhoneID },
      campaignId: { S: campaignId },
      campaignName: { S: campaignName },
      templateUsed: { S: templateUsed }, // Usar el nombre del template
      numbersSent: { SS: successfulNumbers },
      timestamp: { N: timestamp },
    },
  };

  try {
    await dynamoDbClient.send(new PutItemCommand(params));
    console.log("Campaña guardada en DynamoDB");
  } catch (error) {
    console.error("Error al guardar campaña en DynamoDB:", error);
    throw error;
  }
}
