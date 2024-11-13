const express = require('express');
const axios = require('axios');
const twilio = require('twilio');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const path = require('path');

// Configuración de Twilio y OpenAI
const accountSid = "ACCOUNT_SID"; // Reemplaza con tu Account SID
const authToken = "AUTH_TOKEN"; // Reemplaza con tu Auth Token
const client = twilio(accountSid, authToken);
const openaiApiKey = 'OPENAI_API_KEY';

let pdfContents = {};
let welcomeMessageSent = false;

// Función para cargar y extraer contenido de todos los PDFs en la carpeta
async function loadPDFContents() {
    const files = fs.readdirSync(__dirname).filter(file => file.endsWith('.pdf'));

    for (const file of files) {
        try {
            const pdfBuffer = fs.readFileSync(path.join(__dirname, file));
            const data = await pdfParse(pdfBuffer);
            pdfContents[file] = data.text.replace(/\s+/g, ' ').toLowerCase();
            console.log(`Contenido del PDF "${file}" cargado y limpiado.`);
        } catch (error) {
            console.error(`Error al cargar el PDF "${file}":`, error);
        }
    }
}

// Función para obtener respuesta de ChatGPT basada en el contenido de los PDFs y la pregunta del usuario
async function getChatGPTResponse(question) {
    let contentFromPDFs = "";

    for (const [fileName, content] of Object.entries(pdfContents)) {
        contentFromPDFs += `Contenido de ${fileName}:\n${content}\n\n`;
    }

    const prompt = `
Pregunta: "${question}"\n\n
Contexto de los documentos:\n${contentFromPDFs}\n\n
Instrucciones: Responde a la pregunta usando solo la información relevante de los documentos.
    `;

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: "system", content: "Eres un asesor experto que responde a preguntas específicas usando contenido relevante de los documentos proporcionados." },
                    { role: "user", content: prompt }
                ],
                max_tokens: 1000,
                temperature: 0.3
            },
            {
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error("Error al obtener respuesta de ChatGPT:", error.message);
        return "Lo siento, hubo un error al procesar tu solicitud.";
    }
}

// Función para enviar mensajes en fragmentos de 1600 caracteres
function sendTextMessage(sender, message) {
    const MAX_CHAR_LIMIT = 1600;
    const messageChunks = [];

    for (let i = 0; i < message.length; i += MAX_CHAR_LIMIT) {
        messageChunks.push(message.substring(i, i + MAX_CHAR_LIMIT));
    }

    let sendPromise = Promise.resolve();
    messageChunks.forEach((chunk) => {
        sendPromise = sendPromise.then(() => {
            return client.messages
                .create({
                    from: "whatsapp:+14155238886",
                    body: chunk,
                    to: sender,
                })
                .then((msg) => {
                    console.log(`Mensaje enviado con SID: ${msg.sid}`);
                })
                .catch((err) => {
                    console.error(`Error al enviar el fragmento: ${err.message}`);
                    throw err;
                });
        });
    });

    return sendPromise;
}

// Configura el servidor Express para recibir mensajes de Twilio
const app = express();
app.use(express.urlencoded({ extended: true }));

// Ruta para recibir mensajes de Twilio
app.post('/whatsapp', async (req, res) => {
    const sender = req.body.From;
    const question = req.body.Body.trim().toLowerCase();

    console.log(`Pregunta recibida de ${sender}: ${question}`);

    try {
        // Enviar mensaje de bienvenida solo una vez
        if (!welcomeMessageSent) {
            const welcomeMessage = "¡Hola! Soy tu asesor en estrategias. ¿Te gustaría aprender más sobre cómo mejorar tus ventas en TikTok?";
            await sendTextMessage(sender, welcomeMessage);
            welcomeMessageSent = true;
            return res.status(200).end();
        }

        // Respuesta a la pregunta del usuario utilizando el contenido de los PDFs
        const response = await getChatGPTResponse(question);
        await sendTextMessage(sender, response);
    } catch (error) {
        console.error('Error al procesar la pregunta:', error);
    }

    res.status(200).end();  // Responde a Twilio que el mensaje fue procesado correctamente
});

// Inicia el servidor y carga el contenido de los PDFs
const PORT = process.env.PORT || 3000;
loadPDFContents().then(() => {
    app.listen(PORT, () => {
        console.log(`Servidor escuchando en el puerto ${PORT}`);
    });
}).catch(err => {
    console.error("Error al cargar los PDFs:", err);
});
