import type { TServerEventPayloads } from '@dodecagon/shared';
import type { Unsubscribable } from '@trpc/server/observable';
import { observable, type Observable } from '@trpc/server/observable';
import { EventEmitter } from 'events';

type Events = TServerEventPayloads;

class PubSub {
  private ee: EventEmitter;
  private userListeners: Map<
    number,
    Map<string, Set<(data: Events[keyof Events]) => void>>
  > = new Map();
  private channelListeners: Map<
    number,
    Map<string, Set<(data: Events[keyof Events]) => void>>
  > = new Map();

  constructor() {
    this.ee = new EventEmitter();

    this.ee.setMaxListeners(50);
  }

  public publish<TTopic extends keyof Events>(
    topic: TTopic,
    payload: Events[TTopic]
  ): void {
    this.ee.emit(topic, payload);
  }

  public publishFor<TTopic extends keyof Events>(
    userIds: number | number[],
    topic: TTopic,
    payload: Events[TTopic]
  ): void {
    const targetUserIds = Array.isArray(userIds) ? userIds : [userIds];

    for (const userId of targetUserIds) {
      const userTopics = this.userListeners.get(userId);

      if (!userTopics) continue;

      const listeners = userTopics.get(topic);

      if (!listeners) continue;

      for (const listener of listeners) {
        listener(payload);
      }
    }
  }

  public subscribe<TTopic extends keyof Events>(
    topic: TTopic
  ): Observable<Events[TTopic], unknown> {
    return observable((observer) => {
      const listener = (data: Events[TTopic]) => {
        observer.next(data);
      };

      this.ee.on(topic, listener);

      const ee = this.ee;

      const unsubscribable: Unsubscribable = {
        unsubscribe() {
          ee.off(topic, listener);
        }
      };

      return unsubscribable;
    });
  }

  public subscribeFor<TTopic extends keyof Events>(
    userId: number,
    topic: TTopic
  ): Observable<Events[TTopic], unknown> {
    return observable((observer) => {
      const listener = (data: Events[TTopic]) => {
        observer.next(data);
      };

      if (!this.userListeners.has(userId)) {
        this.userListeners.set(userId, new Map());
      }

      const userTopics = this.userListeners.get(userId)!;

      if (!userTopics.has(topic)) {
        userTopics.set(topic, new Set());
      }

      userTopics
        .get(topic)!
        .add(listener as (data: Events[keyof Events]) => void);

      const unsubscribable: Unsubscribable = {
        unsubscribe: () => {
          const userTopics = this.userListeners.get(userId);

          if (!userTopics) return;

          const listeners = userTopics.get(topic);

          if (!listeners) return;

          listeners.delete(listener as (data: Events[keyof Events]) => void);

          if (listeners.size === 0) {
            userTopics.delete(topic);
          }

          if (userTopics.size === 0) {
            this.userListeners.delete(userId);
          }
        }
      };

      return unsubscribable;
    });
  }

  public publishForChannel<TTopic extends keyof Events>(
    channelId: number,
    topic: TTopic,
    payload: Events[TTopic]
  ): void {
    const channelTopics = this.channelListeners.get(channelId);

    if (!channelTopics) return;

    const listeners = channelTopics.get(topic);

    if (!listeners) return;

    for (const listener of listeners) {
      listener(payload);
    }
  }

  public subscribeForChannel<TTopic extends keyof Events>(
    channelId: number,
    topic: TTopic
  ): Observable<Events[TTopic], unknown> {
    return observable((observer) => {
      const listener = (data: Events[TTopic]) => {
        observer.next(data);
      };

      if (!this.channelListeners.has(channelId)) {
        this.channelListeners.set(channelId, new Map());
      }

      const channelTopics = this.channelListeners.get(channelId)!;

      if (!channelTopics.has(topic)) {
        channelTopics.set(topic, new Set());
      }

      channelTopics
        .get(topic)!
        .add(listener as (data: Events[keyof Events]) => void);

      const unsubscribable: Unsubscribable = {
        unsubscribe: () => {
          const channelTopics = this.channelListeners.get(channelId);

          if (!channelTopics) return;

          const listeners = channelTopics.get(topic);

          if (!listeners) return;

          listeners.delete(listener as (data: Events[keyof Events]) => void);

          if (listeners.size === 0) {
            channelTopics.delete(topic);
          }

          if (channelTopics.size === 0) {
            this.channelListeners.delete(channelId);
          }
        }
      };

      return unsubscribable;
    });
  }
}

export const pubsub = new PubSub();
