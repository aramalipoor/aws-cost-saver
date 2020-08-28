import Listr, { ListrTaskWrapper } from 'listr';

export interface TrickInterface<StateType> {
  getMachineName(): string;
  getConserveTitle(): string;
  getRestoreTitle(): string;

  getCurrentState(
    task: ListrTaskWrapper,
    state: StateType,
  ): Promise<Listr | void>;
  conserve(
    task: ListrTaskWrapper,
    state: StateType,
    dryRun: boolean,
  ): Promise<Listr | void>;
  restore(
    task: ListrTaskWrapper,
    state: StateType,
    dryRun: boolean,
  ): Promise<Listr | void>;
}
