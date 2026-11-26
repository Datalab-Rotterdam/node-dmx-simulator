/**
 * Code shared with the simulator server (../src). Import it from
 * here so the UI has a single place that reaches outside this package.
 */
export * from '../../../src/shared/types';
export {BUILT_IN_TYPES, KNOWN_ROLES, SCALE_MAX, SCALE_MIN, channelRoleAt, decodeFixture, resolveLayout} from '../../../src/fixture-types';
export type {DecodedFixture} from '../../../src/fixture-types';
