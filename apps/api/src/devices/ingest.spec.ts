import { mqttOptions } from './ingest';

describe('mqttOptions', () => {
  it('logs in with the API account from the environment', () => {
    const o = mqttOptions({ MQTT_USERNAME: 'api', MQTT_PASSWORD: 'pw' });
    expect(o.username).toBe('api');
    expect(o.password).toBe('pw');
  });

  it('keeps reconnecting after the broker refuses a login', () => {
    // The broker asks this API to check the login, so it refuses while the API is starting.
    const o = mqttOptions({});
    expect(o.reconnectOnConnackError).toBe(true);
    expect(o.reconnectPeriod).toBeGreaterThan(0);
  });
});
