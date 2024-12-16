// index.js (Lambda para obtener templates)

const axios = require("axios");
require("dotenv").config();

// Variables de entorno
const token = process.env.WHATSAPP_TOKEN;
const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

/**
 * Función Lambda para obtener los templates de WhatsApp Business API con componentes.
 */
exports.handler = async (event, context) => {
  try {
    // Construir la URL de la API de WhatsApp Business incluyendo 'components' y 'languages'
    const apiUrl = `https://graph.facebook.com/v21.0/${businessAccountId}/message_templates?limit=1000`;

    // Hacer la solicitud GET a la API
    const response = await axios.get(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    console.log("Respuesta de la API de WhatsApp Business:", response.data);

    // Extraer los datos necesarios
    const templates = response.data.data.map((template) => ({
      id: template.id,
      name: template.name,
      status: template.status,
      components: template.components,
      languages: template.language, // Agregar idiomas disponibles
    }));

    console.log("Templates obtenidos:", templates);

    return {
      statusCode: 200,
      body: JSON.stringify({ templates }),
    };
  } catch (error) {
    console.error(
      "Error al obtener los templates:",
      error.response?.data || error
    );

    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error al obtener los templates" }),
    };
  }
};
