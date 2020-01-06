import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import { LoggingService } from './logging';
import { SubscriptionService } from '../services/subscription';
import { DataStreamController } from '../services/dataStreamProcessor';
import { VideoStreamController } from '../services/videoStreamProcessor';
import {
    IoTCentralService,
    PeabodyModuleFieldIds
} from '../services/iotcentral';
import { sleep, bind } from '../utils';
import * as _get from 'lodash.get';

@service('inferenceProcessor')
export class InferenceProcessorService {
    @inject('$server')
    private server: Server;

    @inject('logger')
    private logger: LoggingService;

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

    public async init(): Promise<void> {
        this.logger.log(['InferenceProcessor', 'info'], 'initialize');

        this.server.method({ name: 'inferenceProcessor.dataInference', method: this.handleDataInference });
        this.server.method({ name: 'inferenceProcessor.videoFrame', method: this.handleVideoFrame });
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
            if (_get(process.env, 'DEBUG_INFERENCE') === '1') {
                for (const inferenceItem of inferences) {
                    if (_get(inferenceItem, 'display_name') !== 'Negative') {
                        this.logger.log(['InferenceProcessor', 'info'], `Inference: `
                            + `id:${_get(inferenceItem, 'id')} `
                            + `"${_get(inferenceItem, 'display_name')}" `
                            + `${_get(inferenceItem, 'confidence')}% `);
                    }
                }
            }

            const publishedInferences = inferences.reduce((publishedItems, inferenceItem) => {
                const confidence = Number(_get(inferenceItem, 'confidence') || 0);
                if (_get(inferenceItem, 'display_name') !== 'Negative' && confidence >= Number(this.iotCentral.iotcPeabodySettings.inferenceThreshold)) {
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

    private async publishInference(inference) {
        const trackTimeout = Date.now();
        this.lastImageData = null;
        while ((Date.now() - trackTimeout) < (1000 * 5) && this.lastImageData === null) {
            await sleep(10);
        }

        this.subscription.publishInference({
            inference,
            imageData: this.lastImageData || Buffer.from('')
        });

        const detectedClasses = {};
        for (const inferenceItem of inference.inferences) {
            const className = (_get(inferenceItem, 'display_name') || 'Unknown');

            detectedClasses[className] = (_get(detectedClasses, className) || 0) + 1;
        }

        let inferenceData = {};
        for (const detectedClass in detectedClasses) {
            if (!detectedClasses.hasOwnProperty(detectedClass)) {
                continue;
            }

            inferenceData = {
                ...inferenceData,
                [PeabodyModuleFieldIds.Event.Inference]: detectedClass,
                ...(detectedClass.toUpperCase() === this.iotCentral.iotcPeabodySettings.detectClass) && {
                    [PeabodyModuleFieldIds.Telemetry.Detections]: _get(detectedClasses, detectedClass)
                }
            };
        }

        await this.iotCentral.sendInferenceData({
            ...inferenceData,
            [PeabodyModuleFieldIds.Telemetry.AllDetections]: inference.inferences.length
        });
    }
}
