ObjC.import('CoreGraphics');
function run(argv) {
  var pt = $.CGPointMake(parseFloat(argv[0]), parseFloat(argv[1]));
  var down = $.CGEventCreateMouseEvent($(), 1, pt, 0); // LeftMouseDown
  $.CGEventPost(0, down);
  delay(0.08);
  var up = $.CGEventCreateMouseEvent($(), 2, pt, 0);   // LeftMouseUp
  $.CGEventPost(0, up);
  return "lclick " + argv[0] + "," + argv[1];
}
