import { ApiError } from '@medichain/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, Screen } from '../../components/ui/Screen';
import { login } from '../../lib/api/client';
import type { AuthStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

/**
 * Sign-in.
 *
 * On success nothing navigates: the store flips to `authenticated` and
 * `RootNavigator` swaps the whole stack. Driving navigation from session state rather
 * than from an imperative `navigate` after login is what makes sign-out, token
 * expiry and a restored Keychain session all land on the correct screen without
 * special cases.
 *
 * A registered-but-unverified account is a normal state, not a failure: the API
 * answers `ACCOUNT_NOT_VERIFIED`, and the user is sent to the OTP screen with their
 * address already filled in.
 */
export function LoginScreen({ navigation }: Props) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [identifierError, setIdentifierError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setIdentifierError(undefined);
    setPasswordError(undefined);

    if (identifier.trim() === '' || password === '') {
      setIdentifierError(identifier.trim() === '' ? 'Enter your email or phone.' : undefined);
      setPasswordError(password === '' ? 'Enter your password.' : undefined);
      return;
    }

    setSubmitting(true);

    try {
      await login({ identifier: identifier.trim(), password });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.requiresVerification) {
          navigation.navigate('Otp', { identifier: identifier.trim() });
          return;
        }

        const issues = error.fieldErrors;
        const identifierIssue = issues.find((issue) => issue.field === 'identifier');
        const passwordIssue = issues.find((issue) => issue.field === 'password');
        setIdentifierError(identifierIssue?.message);
        setPasswordError(passwordIssue?.message);
        if (identifierIssue === undefined && passwordIssue === undefined) {
          setFormError(error.message);
        }
      } else {
        setFormError('Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen title="Sign in" subtitle="Use the email address or phone number on your account.">
      <Card>
        <Input
          label="Email or phone"
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
          autoComplete="username"
          keyboardType="email-address"
          error={identifierError}
        />
        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          error={passwordError}
        />

        {formError !== null ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {formError}
          </Text>
        ) : null}

        <Button title="Sign in" onPress={() => void handleSubmit()} loading={submitting} />
      </Card>

      <Pressable onPress={() => navigation.navigate('Register')} accessibilityRole="link">
        <Text style={styles.link}>Create an account</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { ...typography.muted, color: colors.danger },
  link: {
    ...typography.body,
    color: colors.brand700,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});
