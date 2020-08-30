export function mockSpecificMethods(Klass: any, functionName: string): any {
  const functionNames = [functionName];
  class MockedKlass extends Klass {}

  for (let index = 0, l = functionNames.length; index < l; ++index) {
    const name = functionNames[index];
    MockedKlass.prototype[name] = jest.fn();
  }

  return MockedKlass;
}
