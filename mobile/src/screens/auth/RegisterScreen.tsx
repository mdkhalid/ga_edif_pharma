import { ApiError } from '@medichain/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, Screen } from '../../components/ui/Screen';
import { register } from '../../lib/api/client';
import type { AuthStackParamList } from '../../navigation/types';
import { colors, typography } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

/**
 * Registration.
 *
 * Creates the account and hands off to the OTP screen. The account is created in
 * `PENDING_VERIFICATION` and cannot sign in until the code is accepted, so there is
 * no session to establish here.
 */
export function RegisterScreen({ navigation }: Props) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(): Promise<void> {
    setFormError(null);

    const nextErrors: Record<string, string> = {};
    if (fullName.trim().length < 2) nextErrors['fullName'] = 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors['email'] = 'Enter a valid email address.';
    }
    if (password.length < 12) nextErrors['password'] = 'Use at least 12 characters.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);

    try {
      await register({ fullName: fullName.trim(), email: email.trim(), password });
      navigation.navigate('Otp', { identifier: email.trim() });
    } catch (error) {
      if (error instanceof ApiError) {
        const mapped: Record<string, string> = {};
        for (const issue of error.fieldErrors) mapped[issue.field] ??= issue.message;
        setErrors(mapped);
        if (Object.keys(mapped).length === 0) setFormError(error.message);
      } else {
        setFormError('Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen title="Create an account" subtitle="You will verify your email before you can sign in.">
      <Card>
        <Input
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          autoComplete="name"
          error={errors['fullName']}
        />
        <Input
          label="Email address"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          error={errors['email']}
        />
        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          error={errors['password']}
        />
        <Text style={styles.hint}>At least 12 characters.</Text>

        {formError !== null ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {formError}
          </Text>
        ) : null}

        <Button title="Create account" onPress={() => void handleSubmit()} loading={submitting} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: typography.muted,
  error: { ...typography.muted, color: colors.danger },
});
