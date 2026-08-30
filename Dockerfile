FROM node

WORKDIR /verve

COPY package*.json ./

RUN npm install

COPY . .

# This is where we define where the container will listen,
# and then in the yml file we connect this internal container port to host's 3000 port to access.
EXPOSE 5000

CMD ["node", "server.js"]