FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm install
RUN npx patchright install chromium

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]