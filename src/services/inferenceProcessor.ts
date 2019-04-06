import { service, inject } from 'spryly';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { SubscriptionService } from '../services/subscription';
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

    private inferenceCount: number = 0;
    private lastImageData: Buffer = null;
    private confidenceThreshold: number = defaultConfidenceThreshold;

    public async init(): Promise<void> {
        this.confidenceThreshold = Number(this.config.get('confidenceThreshold')) || defaultConfidenceThreshold;
    }

    public handleDataInference(inference: any) {
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

            this.publishInference({
                timestamp: inference.timestamp,
                inferences: publishedInferences
            });
        }
    }

    public handleVideoFrame(imageData: Buffer) {
        this.lastImageData = Buffer.from(imageData);
    }

    private publishInference(inference) {
        this.subscription.publishInference({
            inference,
            imageData: this.lastImageData
        });
    }
}
