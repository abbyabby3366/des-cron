FROM node:20-alpine

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Expose server port
EXPOSE 3000

# Set default production env variables
ENV NODE_ENV=production
ENV PORT=3000
ENV MONGODB_URI=mongodb+srv://...

# Command to run application
CMD ["npm", "start"]

