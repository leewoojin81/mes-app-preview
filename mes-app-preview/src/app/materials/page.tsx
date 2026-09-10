import ItemMasterView from "@/components/ItemMasterView";

export default function MaterialMasterPage() {
  return (
    <ItemMasterView
      title="자재정보"
      code="BASE-02"
      categories={["원자재"]}
      defaultPageSize={200}
    />
  );
}
