FROM node:14.15.4

WORKDIR /app

COPY . /app

RUN npm install --production

EXPOSE 3000
        
CMD ["node", "index.js"]