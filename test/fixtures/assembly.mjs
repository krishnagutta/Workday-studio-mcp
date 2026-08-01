/**
 * Shared synthetic assembly + diagram fixtures.
 *
 * Deliberately comment-free so every element lands on an odd @mixed index
 * (see docs/studio-integration-patterns.md — "EMF XPath indices count
 * whitespace and comments"). Top-level positions, 1-based:
 *
 *   1 workday-in(@mixed.1)  2 DoStepA(3)  3 Route1(5)  4 OrphanStep(7)
 *   5 DoStepB(9)  6 CallTail(11)  7 TailFlow(13)  8 DoTail(15)
 *   9 GlobalErrorHandler(17)
 */
export const ASSEMBLY = `<beans xmlns:cc="http://www.capeclear.com/assembly/10">
<cc:assembly name="INT999_Test">
  <cc:workday-in id="Input" routes-to="DoStepA"/>
  <cc:async-mediation id="DoStepA" routes-to="Route1" handle-downstream-errors="true">
    <cc:steps>
      <cc:eval id="EvalA"><cc:expression>props['x'] = 1;</cc:expression></cc:eval>
    </cc:steps>
    <cc:send-error id="DoStepAError" rethrow-error="false" routes-to="CallTail"/>
  </cc:async-mediation>
  <cc:route id="Route1" routes-to="DoStepB"/>
  <cc:async-mediation id="OrphanStep">
    <cc:steps>
      <cc:write id="WriteOrphan"/>
    </cc:steps>
  </cc:async-mediation>
  <cc:async-mediation id="DoStepB" routes-to="CallTail"/>
  <cc:local-out id="CallTail" store-message="none" endpoint="vm://INT999_Test/TailFlow"/>
  <cc:local-in id="TailFlow" routes-to="DoTail"/>
  <cc:async-mediation id="DoTail"/>
  <cc:send-error id="GlobalErrorHandler" rethrow-error="false"/>
</cc:assembly>
</beans>`;

export const DIAGRAM = `<diagram>
  <children>
    <visualProperties x="100" y="100">
      <element href="assembly.xml#DoStepA"/>
    </visualProperties>
    <visualProperties x="240" y="100">
      <element href="assembly.xml#Route1"/>
    </visualProperties>
    <visualProperties x="380" y="100">
      <element href="assembly.xml#OrphanStep"/>
    </visualProperties>
    <visualProperties x="520" y="100">
      <element href="assembly.xml#DoStepB"/>
    </visualProperties>
    <visualProperties x="660" y="100">
      <element href="assembly.xml#CallTail"/>
    </visualProperties>
  </children>
  <connections type="routesTo">
    <source href="assembly.xml#DoStepA"/>
    <target href="assembly.xml#Route1"/>
  </connections>
  <connections type="routesTo">
    <source href="assembly.xml#Route1"/>
    <target href="assembly.xml#OrphanStep"/>
  </connections>
  <connections type="routesTo">
    <source href="assembly.xml#//@beans/@mixed.1/@mixed.3/@mixed.3"/>
    <target href="assembly.xml#CallTail"/>
  </connections>
  <connections type="routesTo">
    <source href="assembly.xml#//@beans/@mixed.1/@mixed.17"/>
    <target href="assembly.xml#CallTail"/>
  </connections>
  <swimlanes name="Main Flow" orientation="HORIZONTAL">
    <elements href="assembly.xml#DoStepA"/>
    <elements href="assembly.xml#OrphanStep"/>
    <elements href="assembly.xml#DoStepB"/>
    <elements href="assembly.xml#//@beans/@mixed.1/@mixed.9"/>
    <elements href="assembly.xml#//@beans/@mixed.1/@mixed.7"/>
  </swimlanes>
</diagram>`;

/** A minimal design brief for plan_integration tests. */
export const BRIEF = {
  data_source: 'raas',
  data_destination: 'email-only',
  trigger: 'scheduled',
  record_volume: 'single',
  error_handling: ['integration-messages'],
};

export const subFlows = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `Flow${i}`, description: `desc ${i}` }));
