// Development only: the React dev server forwards /api requests to the backend on this computer.
// This lets the app be opened from a phone on the same Wi-Fi (http://<your-laptop-ip>:3000) or
// through a tunnel URL, without exposing the backend port or changing CORS settings.
// (http-proxy-middleware ships with react-scripts, so nothing extra needs installing.)
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: process.env.BACKEND_PROXY_TARGET || 'http://localhost:8000',
      changeOrigin: true,
      logLevel: 'warn'
    })
  );
};
