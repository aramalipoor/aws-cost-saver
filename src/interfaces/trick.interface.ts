import Listr from 'listr';

export interface TrickInterface<StateType> {
  getMachineName(): string;
  getDisplayName(): string;
  canBeConcurrent(): boolean;
  conserve(subListr: Listr, dryRun: boolean): Promise<StateType>;
  restore(subListr: Listr, dryRun: boolean, state: StateType): Promise<void>;
}
