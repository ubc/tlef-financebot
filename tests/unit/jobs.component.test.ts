jest.mock('agenda', () => ({
  Agenda: jest.fn().mockImplementation(() => ({
    define: jest.fn(),
    now: jest.fn(),
    every: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    close: jest.fn(),
  })),
}));

import { Agenda } from 'agenda';
import { defineJob, enqueueJob, startJobs } from '../../server/src/components/jobs';

describe('jobs component', () => {
  it('registers handlers and enqueues by name', async () => {
    await startJobs();
    const handler = jest.fn();
    defineJob('test-job', handler);
    await enqueueJob('test-job', { x: 1 });

    const mockAgendaInstance = (Agenda as unknown as jest.Mock).mock.results[0].value;
    expect(mockAgendaInstance.define).toHaveBeenCalledWith('test-job', expect.any(Function));
    expect(mockAgendaInstance.now).toHaveBeenCalledWith('test-job', { x: 1 });
  });

  it('stopJobs stops and closes the private mongo connection', async () => {
    // Fresh module + fresh Agenda mock so the singleton `startJobs()` guard
    // actually constructs an instance here (results[0]) to assert against.
    jest.resetModules();
    const agendaMod = require('agenda') as { Agenda: jest.Mock };
    const fresh = require('../../server/src/components/jobs') as typeof import('../../server/src/components/jobs');
    await fresh.startJobs();
    const mockAgendaInstance = agendaMod.Agenda.mock.results[0].value;
    await fresh.stopJobs();
    expect(mockAgendaInstance.stop).toHaveBeenCalledTimes(1);
    expect(mockAgendaInstance.close).toHaveBeenCalledTimes(1);
  });

  it('enqueue before start throws a clear error', async () => {
    jest.resetModules();
    const fresh = require('../../server/src/components/jobs') as typeof import('../../server/src/components/jobs');
    await expect(fresh.enqueueJob('nope', {})).rejects.toThrow(/startJobs/);
  });
});
