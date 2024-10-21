FROM node:14

#  Zuerst die package.json kopieren
COPY package*.json ./

#  Dann npm install ausführen
RUN npm install

#  Danach das Verzeichnis wechseln und die restlichen Dateien kopieren
WORKDIR /app
COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
