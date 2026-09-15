/**
 * Public API of the `onboarding-kyc` module.
 *
 * Only the Nest module is exported. Services stay private; other contexts
 * reach onboarding over HTTP. Imports from outside must go through this file.
 */

export { OnboardingModule } from './onboarding.module';
