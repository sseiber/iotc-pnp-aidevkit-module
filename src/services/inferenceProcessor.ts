import { service, inject } from 'spryly';
import { Server } from 'hapi';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { SubscriptionService } from '../services/subscription';
import { DataStreamController } from '../services/dataStreamProcessor';
import { VideoStreamController } from '../services/videoStreamProcessor';
import { IoTCentralService, DeviceEvent, MessageType } from '../services/iotcentral';
import { sleep, bind } from '../utils';
import * as _get from 'lodash.get';

const defaultConfidenceThreshold: number = 70;

@service('inferenceProcessor')
export class InferenceProcessorService {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

    @inject('config')
    private config: ConfigService;

    @inject('subscription')
    private subscription: SubscriptionService;

    @inject('dataStreamController')
    private dataStreamController: DataStreamController;

    @inject('videoStreamController')
    private videoStreamController: VideoStreamController;

    @inject('iotCentral')
    private iotCentral: IoTCentralService;

    private inferenceCount: number = 0;
    private lastImageData: Buffer = null;
    private confidenceThreshold: number = defaultConfidenceThreshold;

    public async init(): Promise<void> {
        this.confidenceThreshold = Number(this.config.get('confidenceThreshold')) || defaultConfidenceThreshold;
        this.dataStreamController.setInferenceCallback(this.handleDataInference);
        this.videoStreamController.setVideoFrameCallback(this.handleVideoFrame);

        this.server.method({ name: 'inferenceProcessor.inferenceThresholdSettingChange', method: this.handleInferenceThresholdSettingChange });
    }

    public async startInferenceProcessor(rtspDataUrl: string, rtspVideoUrl: string) {
        let result = await this.dataStreamController.startDataStreamProcessor(rtspDataUrl);

        if (result === true) {
            result = await this.videoStreamController.startVideoStreamProcessor(rtspVideoUrl);
        }

        return result;
    }

    public stopInferenceProcessor() {
        this.videoStreamController.stopVideoStreamProcessor();
        this.dataStreamController.stopDataStreamProcessor();
    }

    @bind
    public async handleDataInference(inference: any) {
        const inferences = _get(inference, 'objects');

        if (inferences && Array.isArray(inferences)) {
            for (const inferenceItem of inferences) {
                if (_get(inferenceItem, 'display_name') !== 'Negative') {
                    this.logger.log(['DataStreamController', 'info'], `Inference: `
                        + `id:${_get(inferenceItem, 'id')} `
                        + `"${_get(inferenceItem, 'display_name')}" `
                        + `${_get(inferenceItem, 'confidence')}% `);
                }
            }

            const publishedInferences = inferences.reduce((publishedItems, inferenceItem) => {
                const confidence = Number(_get(inferenceItem, 'confidence') || 0);
                if (_get(inferenceItem, 'display_name') !== 'Negative' && confidence >= this.confidenceThreshold) {
                    publishedItems.push({
                        count: this.inferenceCount++,
                        ...inferenceItem
                    });
                }

                return publishedItems;
            }, []);

            if (publishedInferences.length > 0) {
                await this.publishInference({
                    timestamp: Date.now(),
                    inferences: publishedInferences
                });
            }
        }
    }

    @bind
    public async handleVideoFrame(imageData: Buffer) {
        this.lastImageData = imageData;
    }

    public async getHealth(): Promise<number[]> {
        return [
            this.dataStreamController.getHealth(),
            this.videoStreamController.getHealth()
        ];
    }

    @bind
    private async handleInferenceThresholdSettingChange(inferenceThreshold: number): Promise<any> {
        this.logger.log(['IoTCentralService', 'info'], `Handle setting change for InferenceThreshold: ${inferenceThreshold}`);

        this.confidenceThreshold = inferenceThreshold;

        return {
            value: this.confidenceThreshold,
            status: 'completed'
        };
    }

    private async publishInference(inference): Promise<void> {
        const trackTimeout = Date.now();
        this.lastImageData = null;
        while ((Date.now() - trackTimeout) < (1000 * 5) && this.lastImageData === null) {
            await sleep(10);
        }

        this.subscription.publishInference({
            inference,
            imageData: this.lastImageData || Buffer.from('')
        });

        const data = {
            count: inference.inferences.length,
            classes: inference.inferences.map(inferenceItem => _get(inferenceItem, 'display_name') || 'Unkonwn')
        };

        await this.iotCentral.sendMeasurement(MessageType.Event, { [DeviceEvent.Inference]: data.classes.join(', ') });
    }
}
