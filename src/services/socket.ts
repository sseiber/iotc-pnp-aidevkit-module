import { inject, service } from 'spryly';
import { Server } from '@hapi/hapi';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import * as http from 'http';

export const Subscription = {
    ServerUp: '/subscription/server/up',
    Restart: '/subscription/server/restart',
    Health: '/subscription/server/health',
    Inference: '/subscription/inference',
    ModelChange: '/subscription/modelchange',
    VideoStreamUp: '/subscription/videostream/up',
    VideoStreamDown: '/subscription/videostream/down',
    VideoStreamData: '/subscription/videostream/data'
};

const defaultVideoStreamingServerPort: number = 9012;

@service('socketService')
export class SocketService {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    @inject('logger')
    private logger: LoggingService;

    private streamServer: http.Server = null;
    private videoStreamingServerPort: number = defaultVideoStreamingServerPort;

    public async init(): Promise<void> {
        this.videoStreamingServerPort = this.config.get('videoStreamingServerPort') || defaultVideoStreamingServerPort;
    }

    public async onConnect(socket) {
        this.logger.log(['SocketPlugin', 'info'], `Client connection received, socketId: ${socket.id}`);
    }

    public onDisconnect(socket) {
        this.logger.log(['SocketPlugin', 'info'], `Client disconnected, socketId: ${socket.id}`);
    }

    public startStreamingServer() {
        try {
            this.streamServer = http.createServer((request, response) => {
                const params = request.url.substr(1).split('/');

                if (params[0] !== 'streamer') {
                    this.logger.log(['SocketPlugin', 'info'], `Create http server listener - bad path: ${request.url}`);

                    response.end();
                }

                response.connection.setTimeout(0);
                this.logger.log(['SocketPlugin', 'info'], `Stream connected at ${request.socket.remoteAddress}:${request.socket.remotePort}`);

                request.on('data', (data) => {
                    this.server.publish(Subscription.VideoStreamData, data);
                });

                request.on('end', () => {
                    this.logger.log(['SocketPlugin', 'info'], `http video stream ended`);
                });
            });

            this.streamServer.listen(this.videoStreamingServerPort);
        }
        catch (e) {
            this.logger.log(['SocketPlugin', 'info'], `Error creating listener: ${e.message}`);
        }
    }
}
