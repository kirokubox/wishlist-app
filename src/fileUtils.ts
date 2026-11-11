export const downloadText = (filename: string, text: string, type: string) => {
  downloadBlob(filename, new Blob([text], { type }));
};

export const downloadBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
