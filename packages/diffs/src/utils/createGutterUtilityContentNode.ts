export function createGutterUtilityContentNode(): HTMLElement {
  const gutterUtilityContent = document.createElement('div');
  gutterUtilityContent.slot = 'gutter-utility-slot';
  Object.assign(gutterUtilityContent.style, {
    bottom: '0',
    position: 'absolute',
    textAlign: 'center',
    top: '0',
    whiteSpace: 'normal',
  });
  return gutterUtilityContent;
}
