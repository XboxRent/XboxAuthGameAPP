FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
RUN npx playwright install --with-deps chromium
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","start"]
