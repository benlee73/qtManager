export function createDistributionLoader<Args extends unknown[], Result>(
  load: (...args: Args) => Promise<Result>,
) {
  let requestToken = 0;

  return {
    async load(...args: Args): Promise<Result | null> {
      const token = ++requestToken;
      const result = await load(...args);
      return token === requestToken ? result : null;
    },
    cancel() {
      requestToken += 1;
    },
  };
}
