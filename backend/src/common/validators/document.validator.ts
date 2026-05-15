import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

function validateCpf(digits: string): boolean {
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  if (rem !== parseInt(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  return rem === parseInt(digits[10]);
}

function validateCnpj(digits: string): boolean {
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const check = (d: string, weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + parseInt(d[i]) * w, 0);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  return (
    check(digits, weights1) === parseInt(digits[12]) &&
    check(digits, weights2) === parseInt(digits[13])
  );
}

export function normalizeDocument(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidDocument(value: string): boolean {
  const digits = normalizeDocument(value);
  if (digits.length === 11) return validateCpf(digits);
  if (digits.length === 14) return validateCnpj(digits);
  return false;
}

@ValidatorConstraint({ name: 'isValidDocument', async: false })
export class IsValidDocumentConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    if (typeof value !== 'string') return false;
    return isValidDocument(value);
  }

  defaultMessage(): string {
    return 'CPF or CNPJ is invalid';
  }
}

export function IsValidDocument(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsValidDocumentConstraint,
    });
  };
}
