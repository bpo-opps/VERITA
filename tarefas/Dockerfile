# Painel de Tarefas Opps. O banco (SQLite) e os backups ficam em /app/data: monte um disco persistente aí.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production TZ=America/Sao_Paulo TRUST_PROXY=1 COOKIE_SECURE=1 PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
