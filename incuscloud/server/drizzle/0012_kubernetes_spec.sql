ALTER TABLE "k8s_clusters" ALTER COLUMN "size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "k8s_clusters" ADD COLUMN "spec" jsonb;--> statement-breakpoint
-- Clusters made from a size: the spec that size stood for (specFromSize), pinned to their load balancer's member.
UPDATE "k8s_clusters" SET "spec" = jsonb_build_object(
	'controlPlane', jsonb_build_object('type', 'container', 'flavor', f.flavor, 'profiles', '["default"]'::jsonb, 'target', "lb_member"),
	'worker', jsonb_build_object('type', 'container', 'flavor', f.flavor, 'profiles', '["default"]'::jsonb, 'target', "lb_member"),
	'loadBalancer', jsonb_build_object('type', 'lxc', 'flavor', 'c1-m1', 'profiles', '["default"]'::jsonb, 'target', "lb_member"),
	'image', '', 'privileged', false, 'flannel', true, 'installKubeadm', false,
	'podCidr', '10.244.0.0/16', 'serviceCidr', '10.96.0.0/12', 'metallb', null
) FROM (VALUES ('small', 'c2-m2'), ('medium', 'c2-m4'), ('large', 'c4-m8')) AS f(size, flavor)
WHERE "k8s_clusters"."size" = f.size;--> statement-breakpoint
ALTER TABLE "k8s_clusters" ALTER COLUMN "spec" SET NOT NULL;
