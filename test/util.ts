export function mockSpecificMethods(
  Klass: any,
  functionNames: string | string[],
): any {
  if (!Array.isArray(functionNames)) functionNames = [functionNames];

  class MockedKlass extends Klass {}

  const functionNamesLenght = functionNames.length;
  for (let index = 0; index < functionNamesLenght; ++index) {
    const name = functionNames[index];
    MockedKlass.prototype[name] = jest.fn();
  }

  return MockedKlass;
}
