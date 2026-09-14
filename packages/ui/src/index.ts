/**
 * @medichain/ui
 *
 * Shared web primitives. shadcn/ui's philosophy — components you own rather than a
 * versioned dependency — applied at package scope so the website and the admin
 * portal cannot drift apart visually.
 *
 * The mobile app does NOT consume this package: React Native renders its own views
 * and cannot render DOM elements. Mobile shares only the design tokens.
 */

export { cn } from './lib/cn';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './components/button';
export { Input, type InputProps } from './components/input';
export { Label } from './components/label';
export {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from './components/card';
