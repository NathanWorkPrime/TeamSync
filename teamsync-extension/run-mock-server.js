const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 37845;

app.use(cors({
  origin: '*' // Allow all origins for testing/development
}));

app.use(express.json());

app.post('/start-session', (req, res) => {
  const { repo, branch } = req.body;
  console.log(`[Extension Server] Received start-session for repo: ${repo}, branch: ${branch}`);
  
  const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase() + 
                     '-' + 
                     Math.random().toString(36).substring(2, 6).toUpperCase();
  const sessionLink = `oct://join/TS-${randomCode}`;
  
  console.log(`[Extension Server] Generated session link: ${sessionLink}`);
  res.json({
    success: true,
    link: sessionLink,
    message: 'OCT session successfully created via extension.'
  });
});

app.post('/join-session', (req, res) => {
  const { repo, branch, room_id, session_link } = req.body;
  console.log(`[Extension Server] Received join-session for repo: ${repo}, branch: ${branch}, room_id: ${room_id}, link: ${session_link}`);
  
  res.json({
    success: true,
    link: session_link,
    message: 'OCT session successfully joined via extension.'
  });
});

app.listen(PORT, () => {
  console.log(`[Extension Server] Running companion mock server on http://localhost:${PORT}`);
});
