import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { Subscription } from './socket';
import { IoTCentralService, DeviceEvent, MessageType } from '../services/iotcentral';
import { HealthState } from './serverTypes';
import { spawn } from 'child_process';
import { Transform } from 'stream';
import { type as osType } from 'os';
import { forget } from '../utils';
import * as _get from 'lodash.get';

const rtspVideoCaptureSource = 'rtsp';
const remuxVideoCaptureSource = 'remux';
const defaultVideoCaptureSource = rtspVideoCaptureSource;
const ffmpegCommand = 'ffmpeg';
const ffmpegCaptureCommandArgsMac = '-f avfoundation -framerate 15 -video_device_index ###VIDEO_SOURCE -i default -loglevel quiet -an -f image2pipe -vf scale=640:360,fps=1/2 -q 1 pipe:1';
const ffmpegCaptureCommandArgsLinux = '-f video4linux2 -i ###VIDEO_SOURCE -framerate 15 -loglevel quiet -an -image2pipe -vf scale=640:360,fps=1/2 -q 1 pipe:1';
const ffmpegRtspCommandArgs = '-i ###VIDEO_SOURCE -loglevel quiet -an -f image2pipe -vf fps=1/2 -q 1 pipe:1';
const ffmpegRtspRemuxCommandArgs = '-i ###VIDEO_SOURCE -loglevel verbose -vcodec copy -an -sn -dn -reset_timestamps 1 ' +
    '-movflags empty_moov+default_base_moof+frag_keyframe -bufsize 256k -f mp4 -seekable 0 ' +
    '-headers Access-Control-Allow-Origin:* -content_type video/mp4 http://127.0.0.1:9012/streamer';

@service('videoStreamController')
export class VideoStreamController {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

    @inject('config')
    private config: ConfigService;

    @inject('iotCentral')
    private iotCentral: IoTCentralService;

    private videoCaptureSource: string = defaultVideoCaptureSource;
    private ffmpegProcess: any = null;
    private healthState: number = HealthState.Good;

    public async init(): Promise<void> {
        this.videoCaptureSource = this.config.get('videoCaptureSource') || defaultVideoCaptureSource;
    }

    public async startVideoStreamProcessor(videoStreamUrl: string): Promise<boolean> {
        if (!videoStreamUrl) {
            this.logger.log(['VideoStreamController', 'warning'], `Not starting image capture processor because videoStreamUrl is empty`);
        }

        this.logger.log(['VideoStreamController', 'info'], `Starting image capture processor`);

        let ffmpegCommandArgs;
        if (this.videoCaptureSource === rtspVideoCaptureSource) {
            ffmpegCommandArgs = ffmpegRtspCommandArgs.replace('###VIDEO_SOURCE', videoStreamUrl).split(' ');
        }
        else if (this.videoCaptureSource === remuxVideoCaptureSource) {
            ffmpegCommandArgs = ffmpegRtspRemuxCommandArgs.replace('###VIDEO_SOURCE', videoStreamUrl).split(' ');
        }
        else {
            ffmpegCommandArgs = osType() === 'Darwin'
                ? ffmpegCaptureCommandArgsMac.replace('###VIDEO_SOURCE', this.videoCaptureSource).split(' ')
                : ffmpegCaptureCommandArgsLinux.replace('###VIDEO_SOURCE', this.videoCaptureSource).split(' ');
        }

        try {
            this.ffmpegProcess = spawn(ffmpegCommand, ffmpegCommandArgs, { stdio: ['ignore', 'pipe', 'ignore'] });

            this.ffmpegProcess.on('error', (error) => {
                this.logger.log(['videoController', 'error'], `Error on ffmpegProcess: ${_get(error, 'message')}`);

                forget(this.iotCentral.sendMeasurement, MessageType.Event, { [DeviceEvent.VideoStreamProcessingError]: _get(error, 'message') });

                this.healthState = HealthState.Critical;
            });

            this.ffmpegProcess.on('exit', (code, signal) => {
                this.logger.log(['videoController', 'info'], `Exit on ffmpegProcess, code: ${code}, signal: ${signal}`);

                forget(this.iotCentral.sendMeasurement, MessageType.Event, { [DeviceEvent.VideoStreamProcessingStopped]: '1' });

                if (this.ffmpegProcess !== null) {
                    // abnormal exit
                    this.healthState = HealthState.Warning;
                }

                this.ffmpegProcess = null;
            });

            if (this.videoCaptureSource === rtspVideoCaptureSource) {
                const frameProcessor = new FrameProcessor({});

                // @ts-ignore (jpegData)
                frameProcessor.on('jpeg', (jpegData: any) => {
                    this.logger.log(['videoController', 'info'], `Received video frame`);
                });

                this.ffmpegProcess.stdout.pipe(frameProcessor);
            }
            else if (this.videoCaptureSource === remuxVideoCaptureSource) {
                this.server.publish(Subscription.VideoStreamUp, {});
            }

            await this.iotCentral.sendMeasurement(MessageType.Event, { [DeviceEvent.VideoStreamProcessingStarted]: '1' });

            return true;
        }
        catch (ex) {
            this.logger.log(['videoController', 'error'], ex.message);

            return false;
        }
    }

    public stopVideoStreamProcessor() {
        if (!this.ffmpegProcess) {
            return;
        }

        const process = this.ffmpegProcess;
        this.ffmpegProcess = null;

        process.kill();

        return;
    }

    public getHealth(): number {
        return this.healthState;
    }
}

const _SOI = Buffer.from([0xff, 0xd8]);
const _EOI = Buffer.from([0xff, 0xd9]);

class FrameProcessor extends Transform {
    private chunks = [];
    private size = 0;
    private internalJpeg: Buffer;
    private internalTimestamp: number;

    constructor(options) {
        super(options);

        this.chunks = [];
        this.size = 0;
        this.internalJpeg = null;
        this.internalTimestamp = Date.now();
    }

    public get jpeg() {
        return this.internalJpeg || null;
    }

    public get timestamp() {
        return this.internalTimestamp;
    }

    // @ts-ignore (encoding)
    public _transform(chunk: Buffer, encoding: string, done: callback) {
        const chunkLength = chunk.length;
        let pos = 0;

        try {
            while (true) {
                if (this.size) {
                    const eoi = chunk.indexOf(_EOI);
                    if (eoi === -1) {
                        this.chunks.push(chunk);
                        this.size += chunkLength;

                        break;
                    } else {
                        pos = eoi + 2;
                        const sliced = chunk.slice(0, pos);
                        this.chunks.push(sliced);
                        this.size += sliced.length;
                        this.internalJpeg = Buffer.concat(this.chunks, this.size);
                        this.internalTimestamp = Date.now();
                        this.chunks = [];
                        this.size = 0;

                        if ((this as any)._readableState.pipesCount > 0) {
                            this.push(this.internalJpeg);
                        }

                        if (this.listenerCount('jpeg') > 0) {
                            this.emit('jpeg', this.internalJpeg);
                        }

                        if (pos === chunkLength) {
                            break;
                        }
                    }
                } else {
                    const soi = chunk.indexOf(_SOI, pos);
                    if (soi === -1) {
                        break;
                    } else {
                        // todo might add option or take sample average / 2 to jump position for small gain
                        pos = soi + 500;
                    }

                    const eoi = chunk.indexOf(_EOI, pos);
                    if (eoi === -1) {
                        const sliced = chunk.slice(soi);
                        this.chunks = [sliced];
                        this.size = sliced.length;

                        break;
                    } else {
                        pos = eoi + 2;
                        this.internalJpeg = chunk.slice(soi, pos);
                        this.internalTimestamp = Date.now();

                        if ((this as any)._readableState.pipesCount > 0) {
                            this.push(this.internalJpeg);
                        }

                        if (this.listenerCount('jpeg') > 0) {
                            this.emit('jpeg', this.internalJpeg);
                        }

                        if (pos === chunkLength) {
                            break;
                        }
                    }
                }
            }
        }
        catch (ex) {
            // tslint:disable no-console variable-name
            console.log(`##JPEG parse exception`);
        }

        return done();
    }
}
