require('dotenv').config();
console.log('MONGO_URI:', process.env.MONGO_URI);
console.log("🔍 Current directory:", __dirname);
console.log("🔑 Attempting to load .env from:", require('path').resolve('.env'));
console.log("📝 .env contents:", require('fs').readFileSync('.env', 'utf8'));
console.log("✅ Loaded API Key:", process.env.ELEVENLABS_API_KEY || "Not found!");

const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
const PORT = 3001; // Different port to avoid conflicts

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/grammar_guru';
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// User schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    mobile: { type: String, required: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// Call session schema for tracking active calls
const callSessionSchema = new mongoose.Schema({
    callId: { type: String, required: true, unique: true },
    phoneNumber: { type: String, required: true },
    status: { type: String, enum: ['initiated', 'active', 'completed', 'failed'], default: 'initiated' },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    duration: { type: Number }, // in seconds
    conversationLog: [{
        timestamp: { type: Date, default: Date.now },
        speaker: { type: String, enum: ['user', 'agent', 'system'], required: true },
        message: String
    }],
    createdAt: { type: Date, default: Date.now }
});
const CallSession = mongoose.model('CallSession', callSessionSchema);

// Register endpoint
app.post('/api/register', async (req, res) => {
    try {
        const { username, mobile, password } = req.body;
        if (!username || !mobile || !password) {
            return res.status(400).json({ success: false, error: 'All fields are required.' });
        }
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(409).json({ success: false, error: 'Username already exists.' });
        }
        const user = new User({ username, mobile, password });
        await user.save();
        res.json({ success: true, user: { username, mobile } });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Registration failed.' });
    }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'All fields are required.' });
        }
        const user = await User.findOne({ username });
        if (!user || user.password !== password) {
            return res.status(401).json({ success: false, error: 'Invalid username or password.' });
        }
        res.json({ success: true, user: { username: user.username, mobile: user.mobile } });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Login failed.' });
    }
});

// ElevenLabs Configuration
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = 'agent_5401k1aqhf5jfr0rfkawahmpm1w0';
const PHONE_NUMBER_ID = 'phnum_3701k1asdcmweq3bxqr3hn9pnesy';

// Serve the simple call app
app.get('/', (req, res) => {
    console.log('📄 Serving simple_call_app.html');
    res.sendFile(path.join(__dirname, 'simple_call_app.html'));
});

// API endpoint to make a call
app.post('/api/make-call', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ 
                success: false,
                error: 'Phone number is required' 
            });
        }

        if (!ELEVENLABS_API_KEY) {
            return res.status(500).json({ 
                success: false,
                error: 'ElevenLabs API key not configured. Please add ELEVENLABS_API_KEY to your .env file' 
            });
        }

        console.log(`🚀 Making call to: ${phoneNumber}`);
        console.log(`🤖 Agent ID: ${AGENT_ID}`);
        console.log(`📱 Phone Number ID: ${PHONE_NUMBER_ID}`);

        const callData = {
            agent_id: AGENT_ID,
            agent_phone_number_id: PHONE_NUMBER_ID,
            to_number: phoneNumber
        };

        const response = await axios.post(
            'https://api.elevenlabs.io/v1/convai/twilio/outbound-call',
            callData,
            {
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        console.log('✅ Call initiated successfully!');
        console.log('📊 Call Details:', JSON.stringify(response.data, null, 2));

        // Create call session record
        const callSession = new CallSession({
            callId: response.data.conversation_id, // Or callSid if you prefer
            phoneNumber: phoneNumber,
            status: 'initiated',
            conversationLog: [{
                speaker: 'system',
                message: 'Call initiated successfully'
            }]
        });
        await callSession.save();

        // Remove all setTimeout and status polling logic here
        // Do not poll for call status or update session after a delay

        res.json({
            success: true,
            message: 'Call initiated successfully',
            callId: response.data.conversation_id, // Or callSid if you prefer
            sessionId: callSession._id
        });

    } catch (error) {
        console.error('❌ Error making call:', error.response?.data || error.message);
        
        let errorMessage = 'Failed to make call';
        let statusCode = 500;
        
        if (error.response?.status === 401) {
            errorMessage = 'API Key Error: Check your ELEVENLABS_API_KEY in .env file';
            statusCode = 401;
        } else if (error.response?.status === 400) {
            errorMessage = 'Phone Number Error: Make sure your number is in E.164 format';
            statusCode = 400;
        } else if (error.response?.status === 429) {
            errorMessage = 'Rate limit exceeded. Please try again later.';
            statusCode = 429;
        } else if (error.code === 'ECONNABORTED') {
            errorMessage = 'Request timeout. Please try again.';
            statusCode = 408;
        } else if (error.response?.data?.detail) {
            errorMessage = error.response.data.detail;
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(statusCode).json({
            success: false,
            error: errorMessage
        });
    }
});

// Function to check call status
// async function checkCallStatus(callId) {
//     try {
//         const response = await axios.get(
//             `https://api.elevenlabs.io/v1/convai/twilio/call/${callId}`,
//             {
//                 headers: {
//                     'xi-api-key': ELEVENLABS_API_KEY
//                 }
//             }
//         );
//         console.log("📩 ElevenLabs API raw response:", response.data);
//         const callData = response.data;
//         const callStatus = callData?.status || callData?.data?.status;
//         console.log(`📞 Call ${callId} status:`, callStatus);
        

//         // Update call session
//         const callSession = await CallSession.findOne({ callId: callId });
//         if (callSession) {
//             callSession.status = callStatus;
//             if (callStatus === 'completed' || callStatus === 'failed') {
//                 callSession.endTime = new Date();
//                 callSession.duration = Math.floor((callSession.endTime - callSession.startTime) / 1000);
//             }
//             await callSession.save();
//         }

//         // If call is still active, check again in 10 seconds
//         if (callData.status === 'in-progress' || callData.status === 'ringing') {
//             setTimeout(() => checkCallStatus(callId), 10000);
//         }

//     } catch (error) {
//         console.error(`Error checking call status for ${callId}:`, error.message);
//     }
// }
// axios.post('https://api.elevenlabs.io/v1/convai/twilio/call', ...)

const checkCallStatus = async (conversationId) => {
    try {
      console.log("🔍 Checking status for conversation:", conversationId);
  
      const response = await axios.get(
        `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
        {
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
          },
        }
      );
  
      console.log("✅ Call status response:", response.data);
      return response.data;
  
    } catch (error) {
      console.error(
        `❌ Error checking call status for ${conversationId}:`,
        error.response?.status,
        error.response?.data || error.message
      );
    }
  };
  
//   console.log("📞 Response from ElevenLabs:", response.data);

// Endpoint to get call status
app.get('/api/call-status/:callId', async (req, res) => {
    try {
        const { callId } = req.params;
        const callSession = await CallSession.findOne({ callId: callId });
        
        if (!callSession) {
            return res.status(404).json({ success: false, error: 'Call session not found' });
        }

        res.json({
            success: true,
            callStatus: callSession.status,
            duration: callSession.duration,
            startTime: callSession.startTime,
            endTime: callSession.endTime
        });

    } catch (error) {
        console.error('Error getting call status:', error);
        res.status(500).json({ success: false, error: 'Failed to get call status' });
    }
});

// Endpoint to end call manually
app.post('/api/end-call/:callId', async (req, res) => {
    try {
        const { callId } = req.params;
        
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/convai/twilio/call/${callId}/end`,
            {},
            {
                headers: {
                    'xi-api-key': process.env.ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Update call session
        const callSession = await CallSession.findOne({ callId: callId });
        if (callSession) {
            callSession.status = 'completed';
            callSession.endTime = new Date();
            callSession.duration = Math.floor((callSession.endTime - callSession.startTime) / 1000);
            await callSession.save();
        }

        res.json({
            success: true,
            message: 'Call ended successfully'
        });

    } catch (error) {
        console.error('Error ending call:', error);
        res.status(500).json({ success: false, error: 'Failed to end call' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'FINAL Grammar Guru Call App is running',
        timestamp: new Date().toISOString(),
        apiKeyConfigured: !!ELEVENLABS_API_KEY
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 FINAL Grammar Guru Call App running on http://localhost:${PORT}`);
    console.log(`📞 Call endpoint: POST http://localhost:${PORT}/api/make-call`);
    console.log(`🔑 API Key configured: ${ELEVENLABS_API_KEY ? 'Yes' : 'No'}`);
    if (!ELEVENLABS_API_KEY) {
        console.log(`⚠️  WARNING: ELEVENLABS_API_KEY not found in .env file`);
        console.log(`📝 Please create a .env file with: ELEVENLABS_API_KEY=your_api_key_here`);
    }
});

module.exports = app; 