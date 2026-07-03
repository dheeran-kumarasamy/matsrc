import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { JobsOptions, Queue } from "bullmq";
import IORedis from "ioredis";
import { NOTIFICATIONS_QUEUE_NAME, NotificationJobData } from "./notification.types";

@Injectable()
export class NotificationQueueService implements OnModuleInit, OnModuleDestroy {
  private connection: IORedis | null = null;
  private queue: Queue<NotificationJobData> | null = null;

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return;
    }

    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.queue = new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }

  async enqueue(jobName: string, data: NotificationJobData, opts?: JobsOptions): Promise<boolean> {
    if (!this.queue) {
      return false;
    }

    await this.queue.add(jobName, data, opts);
    return true;
  }

  getConnection() {
    return this.connection;
  }

  async onModuleDestroy() {
    await this.queue?.close();
    this.queue = null;

    await this.connection?.quit();
    this.connection = null;
  }
}