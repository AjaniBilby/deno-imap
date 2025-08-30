export function* ChunkArray<T>(arr: Array<T>, chunkSize: number) {
  for (let i = 0; i < arr.length; i += chunkSize) yield arr.slice(i, i + chunkSize);
}
