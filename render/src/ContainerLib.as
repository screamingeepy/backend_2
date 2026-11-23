// Document class for containerLib.swf, and deliberately empty.
//
// The point of this SWF is the classes build-containerlib.ps1 forces into it
// with -includes, not anything it does when loaded. container.swf's real
// document class, com.disney.fairies.Container, boots the site and calls
// ExternalInterface -- which throws Error #2067 in a projector and kills the
// harness's boot chain. This stands in its place so the library can be loaded
// for its definitions alone.
package
{
   import flash.display.Sprite;

   public class ContainerLib extends Sprite
   {
      public function ContainerLib()
      {
         super();
      }
   }
}
