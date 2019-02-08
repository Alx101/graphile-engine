// @flow
/* eslint-disable flowtype/no-weak-types */
import callbackToAsyncIterator from "./callbackToAsyncIterator";
import type { GraphQLResolveInfo } from "graphql";
import { debounce } from "lodash";

type SubscriptionReleaser = () => void;
type SubscriptionCallback = () => void;

export class LiveSource {
  subscribeCollection(
    _callback: SubscriptionCallback,
    _collectionIdentifier: any,
    _predicate?: (record: any) => boolean
  ): SubscriptionReleaser | null {
    return null;
  }

  subscribeRecord(
    _callback: SubscriptionCallback,
    _collectionIdentifier: any,
    _recordIdentifier: any
  ): SubscriptionReleaser | null {
    return null;
  }
}

export class LiveProvider {
  sources: Array<LiveSource>;
  namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
    this.sources = [];
  }

  registerSource(source: LiveSource) {
    this.sources.push(source);
  }

  collectionIdentifierIsValid(_collectionIdentifier: any): boolean {
    return false;
  }

  recordIdentifierIsValid(
    _collectionIdentifier: any,
    _recordIdentifier: any
  ): boolean {
    return false;
  }
}

export class LiveMonitor {
  providers: { [namespace: string]: LiveProvider };
  subscriptionReleasers: (() => void)[];

  constructor(providers: { [namespace: string]: LiveProvider }) {
    this.providers = providers;
    this.subscriptionReleasers = [];
    this.handleChange = this.handleChange.bind(this);
    this.onChange = this.onChange.bind(this);
  }

  reset() {
    // clear monitoring
    for (const releaser of this.subscriptionReleasers) {
      releaser();
    }
    this.subscriptionReleasers = [];
  }

  release() {
    this.reset();
  }

  handleChange() {
    if (this.changeCallback) {
      this.changeCallback();
    } else {
      // eslint-disable-next-line no-console
      console.warn("Change occurred, but no-one was listening");
    }
  }

  onChange(callback: () => void) {
    if (this.changeCallback) {
      throw new Error("Already monitoring for changes");
    }
    // Debounce to every 250ms
    this.changeCallback = debounce(callback, 250, {
      leading: true,
      trailing: true,
    });
    setTimeout(this.handleChange, 0);
    return () => {
      this.changeCallback = null;
    };
  }

  liveCollection(
    info: GraphQLResolveInfo,
    namespace: string,
    collectionIdentifier: any,
    predicate: (record: any) => boolean = () => true
  ) {
    const provider = this.providers[namespace];
    if (!provider || provider.sources.length === 0) return;
    if (!provider.collectionIdentifierIsValid(collectionIdentifier)) {
      throw new Error(
        `Invalid collection identifier passed to LiveMonitor[${namespace}]: ${collectionIdentifier}`
      );
    }
    for (const source of provider.sources) {
      const releaser = source.subscribeCollection(
        this.handleChange,
        collectionIdentifier,
        predicate
      );
      if (releaser) {
        this.subscriptionReleasers.push(releaser);
      }
    }
  }

  liveRecord(
    info: GraphQLResolveInfo,
    namespace: string,
    collectionIdentifier: any,
    recordIdentifier: any
  ) {
    // TODO: if (recordIdentifier == null) {return}
    const provider = this.providers[namespace];
    if (!provider || provider.sources.length === 0) return;
    if (!provider.collectionIdentifierIsValid(collectionIdentifier)) {
      throw new Error(
        `Invalid collection identifier passed to LiveMonitor[${namespace}]: ${collectionIdentifier}`
      );
    }
    if (
      !provider.recordIdentifierIsValid(collectionIdentifier, recordIdentifier)
    ) {
      throw new Error(
        `Invalid record identifier passed to LiveMonitor[${namespace}]: ${collectionIdentifier}`
      );
    }
    for (const source of provider.sources) {
      const releaser = source.subscribeRecord(
        this.handleChange,
        collectionIdentifier,
        recordIdentifier
      );
      if (releaser) {
        this.subscriptionReleasers.push(releaser);
      }
    }
  }
}

export class LiveCoordinator {
  providers: { [namespace: string]: LiveProvider };

  constructor() {
    this.providers = {};
    this.subscribe = this.subscribe.bind(this);
  }

  registerProvider(provider: LiveProvider) {
    const { namespace } = provider;
    if (this.providers[namespace]) {
      throw new Error(`Namespace ${namespace} already registered with Live`);
    }
    this.providers[namespace] = provider;
  }

  registerSource(namespace: string, source: LiveSource) {
    if (!this.providers[namespace]) {
      // eslint-disable-next-line no-console
      console.warn(
        `LiveProvider '${namespace}' is not registered, skipping live source.`
      );
      return;
    }
    this.providers[namespace].registerSource(source);
  }

  getMonitorAndContext() {
    const monitor = new LiveMonitor(this.providers);
    return {
      monitor,
      context: {
        liveCollection: monitor.liveCollection.bind(monitor),
        liveRecord: monitor.liveRecord.bind(monitor),
      },
    };
  }

  subscribe(_parent: any, _args: any, context: any, _info: GraphQLResolveInfo) {
    const { monitor, context: additionalContext } = this.getMonitorAndContext();
    Object.assign(context, additionalContext);
    return makeAsyncIteratorFromMonitor(monitor);
  }
}

export function makeAsyncIteratorFromMonitor(monitor: LiveMonitor) {
  return callbackToAsyncIterator(monitor.onChange, {
    onClose: release => {
      release();
    },
  });
}
