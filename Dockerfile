FROM arm32v7/alpine:3.9

RUN apk update && apk add --no-cache nodejs nodejs-npm --repository=http://dl-cdn.alpinelinux.org/alpine/edge/main

# RUN apk add libgstreamer1.0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav gstreamer1.0-doc gstreamer1.0-tools --repository=http://dl-cdn.alpinelinux.org/alpine/edge/main

ENV WORKINGDIR /app
WORKDIR ${WORKINGDIR}

ADD THIRDPARTYNOTICE.TXT ${WORKINGDIR}/THIRDPARTYNOTICE.TXT
ADD package.json ${WORKINGDIR}/package.json
ADD tslint.json ${WORKINGDIR}/tslint.json
ADD tsconfig.json ${WORKINGDIR}/tsconfig.json
ADD src ${WORKINGDIR}/src
ADD client_dist ${WORKINGDIR}/client_dist
ADD .npmrc ${WORKINGDIR}/.npmrc

RUN npm install -q && \
    ./node_modules/.bin/tsc -p . && \
    ./node_modules/.bin/tslint -p . && \
    npm prune --production && \
    rm -f tslint.json && \
    rm -f tsconfig.json && \
    rm -f .npmrc && \
    rm -rf src

EXPOSE 9010

CMD ["node", "./dist/index"]
