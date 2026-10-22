# Natija reminders only: the public website remains on GitHub Pages.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY http-runner.js send-reminders.js telegram-reminders.js send-email-reminders.js run-once.js ./

USER node
CMD ["node", "run-once.js"]
