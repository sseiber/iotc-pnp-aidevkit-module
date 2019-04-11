import { service, inject } from 'spryly';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { SubscriptionService } from '../services/subscription';
import { DataStreamController } from '../services/dataStreamProcessor';
import { VideoStreamController } from '../services/videoStreamProcessor';
import { IoTCentralService, DeviceTelemetry } from '../services/iotcentral';
import { sleep, bind, forget } from '../utils';
import * as _get from 'lodash.get';

const defaultConfidenceThreshold: number = 70;

@service('inferenceProcessor')
export class InferenceProcessorService {
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
                this.logger.log(['DataStreamController', 'info'], `Inference: `
                    + `id:${_get(inferenceItem, 'id')} `
                    + `"${_get(inferenceItem, 'display_name')}" `
                    + `${_get(inferenceItem, 'confidence')}% `);
            }

            const publishedInferences = inferences.reduce((publishedItems, inferenceItem) => {
                const confidence = Number(_get(inferenceItem, 'confidence') || 0);
                if (confidence >= this.confidenceThreshold) {
                    publishedItems.push({
                        count: this.inferenceCount++,
                        ...inferenceItem
                    });
                }

                return publishedItems;
            }, []);

            await this.publishInference({
                timestamp: Date.now(),
                inferences: publishedInferences
            });
        }
    }

    @bind
    public async handleVideoFrame(imageData: Buffer) {
        this.lastImageData = imageData;
    }

    private async publishInference(inference) {
        this.lastImageData = null;
        while (!this.lastImageData) {
            await sleep(10);
        }

        const data = {
            inference: inference.inferences.length,
            inferences: inference.inferences
        };

        forget(this.iotCentral.sendMeasurement, [DeviceTelemetry.Inference], data);

        this.subscription.publishInference({
            inference,
            imageData: this.lastImageData
        });
    }
}
