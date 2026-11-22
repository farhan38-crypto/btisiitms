# The app's frontend (Vite dev server). Vite 8 needs Node 20.19+ or 22.12+.
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
EXPOSE 3000
CMD ["npx", "vite", "--port", "3000", "--strictPort", "--host", "0.0.0.0"]
