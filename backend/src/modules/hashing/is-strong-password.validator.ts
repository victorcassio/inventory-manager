import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { validatePasswordPolicy } from './password-policy';

export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return validatePasswordPolicy(value).length === 0;
        },
        defaultMessage(args: ValidationArguments) {
          // Returns the rule text only — never the submitted value.
          return validatePasswordPolicy(args.value).join('; ');
        },
      },
    });
  };
}
